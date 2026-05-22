import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.addScope("email");
googleProvider.setCustomParameters({ prompt: "select_account" });
auth.languageCode = "pt-BR";

const loginPanel = document.querySelector("[data-admin-login]");
const googleLoginButton = document.querySelector("[data-google-login]");
const sessionPanel = document.querySelector("[data-admin-session]");
const ordersPanel = document.querySelector("[data-admin-orders]");
const orderList = document.querySelector("[data-order-list]");
const adminStatus = document.querySelector("[data-admin-status]");
const adminName = document.querySelector("[data-admin-name]");
const adminEmail = document.querySelector("[data-admin-email]");
const adminAvatar = document.querySelector("[data-admin-avatar]");
const logoutButton = document.querySelector("[data-admin-logout]");
const pendingCount = document.querySelector("[data-pending-count]");

let currentUser = null;
let unsubscribeOrders = null;

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const setStatus = (message) => {
  adminStatus.textContent = message;
};

const setLoginBusy = (isBusy) => {
  googleLoginButton.disabled = isBusy;
  googleLoginButton.classList.toggle("is-loading", isBusy);
};

const formatDate = (timestamp) => {
  if (!timestamp?.toDate) {
    return "Sem data";
  }

  return timestamp.toDate().toLocaleString("pt-BR");
};

const getOrderNumbers = (order) =>
  Object.keys(order.numberMap || {})
    .map(Number)
    .filter(Number.isInteger)
    .sort((a, b) => a - b);

const updatePendingCount = (total) => {
  pendingCount.textContent = total === 1 ? "1 pendente" : `${total} pendentes`;
};

const renderOrders = (orders) => {
  orderList.innerHTML = "";
  updatePendingCount(orders.length);

  if (!orders.length) {
    const empty = document.createElement("p");
    empty.className = "empty-filter";
    empty.textContent = "Nenhum pagamento pendente no momento.";
    orderList.append(empty);
    return;
  }

  orders.forEach(({ id, data }) => {
    const article = document.createElement("article");
    article.className = "order-card";

    const numbers = getOrderNumbers(data);
    const header = document.createElement("div");
    header.className = "order-card-header";

    const buyerBlock = document.createElement("div");
    const buyer = document.createElement("strong");
    buyer.textContent = data.buyerName || "Sem nome";

    const date = document.createElement("span");
    date.textContent = formatDate(data.createdAt);
    buyerBlock.append(buyer, date);

    const amount = document.createElement("b");
    amount.textContent = currency.format((data.amountCents || 0) / 100);
    header.append(buyerBlock, amount);

    const numberList = document.createElement("p");
    numberList.className = "order-numbers";
    numberList.textContent = `Números: ${numbers.join(", ")}`;

    const paymentHint = document.createElement("p");
    paymentHint.className = "order-payment-hint";
    paymentHint.textContent =
      "Confira no app do banco se o Pix caiu no CPF 972.876.601-72 com o valor acima antes de confirmar.";

    const actions = document.createElement("div");
    actions.className = "order-actions";

    const confirmButton = document.createElement("button");
    confirmButton.className = "button button-primary";
    confirmButton.type = "button";
    confirmButton.textContent = "Confirmar pagamento";
    confirmButton.addEventListener("click", () => confirmOrder(id, data));

    const rejectButton = document.createElement("button");
    rejectButton.className = "button button-ghost";
    rejectButton.type = "button";
    rejectButton.textContent = "Rejeitar";
    rejectButton.addEventListener("click", () => rejectOrder(id));

    actions.append(confirmButton, rejectButton);
    article.append(header, numberList, paymentHint, actions);
    orderList.append(article);
  });
};

const subscribeOrders = () => {
  if (unsubscribeOrders) {
    unsubscribeOrders();
  }

  unsubscribeOrders = onSnapshot(
    collection(db, "orders"),
    (snapshot) => {
      const orders = [];

      snapshot.forEach((orderDoc) => {
        const data = orderDoc.data();

        if (data.status === "pending") {
          orders.push({ id: orderDoc.id, data });
        }
      });

      orders.sort((a, b) => {
        const aTime = a.data.createdAt?.toMillis?.() || 0;
        const bTime = b.data.createdAt?.toMillis?.() || 0;
        return aTime - bTime;
      });

      renderOrders(orders);
      setStatus(`Conectado como ${currentUser.email || "admin"}.`);
    },
    () => {
      updatePendingCount(0);
      setStatus("Sem permissão para ler pedidos. Adicione seu UID em admins/{uid} no Firestore.");
    }
  );
};

const confirmOrder = async (orderId, order) => {
  const numbers = getOrderNumbers(order);

  if (!numbers.length) {
    setStatus("Pedido sem números válidos.");
    return;
  }

  try {
    await runTransaction(db, async (transaction) => {
      const orderRef = doc(db, "orders", orderId);
      const orderSnapshot = await transaction.get(orderRef);

      if (!orderSnapshot.exists() || orderSnapshot.data().status !== "pending") {
        throw new Error("Pedido já foi alterado.");
      }

      const ticketRefs = numbers.map((number) => doc(db, "tickets", String(number)));
      const ticketSnapshots = [];

      for (const ticketRef of ticketRefs) {
        ticketSnapshots.push(await transaction.get(ticketRef));
      }

      ticketSnapshots.forEach((ticketSnapshot, index) => {
        if (ticketSnapshot.exists()) {
          throw new Error(`Número ${numbers[index]} já está vendido.`);
        }
      });

      ticketRefs.forEach((ticketRef, index) => {
        transaction.set(ticketRef, {
          number: numbers[index],
          buyerName: String(order.buyerName || "Comprador").slice(0, 80),
          status: "paid",
          amountCents: 2000,
          orderId,
          adminId: currentUser.uid,
          createdAt: serverTimestamp(),
          confirmedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      transaction.update(orderRef, {
        status: "confirmed",
        adminId: currentUser.uid,
        confirmedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    setStatus("Pagamento confirmado e números marcados como vendidos.");
  } catch (error) {
    setStatus(error.message || "Não foi possível confirmar o pedido.");
  }
};

const rejectOrder = async (orderId) => {
  try {
    await runTransaction(db, async (transaction) => {
      const orderRef = doc(db, "orders", orderId);
      const orderSnapshot = await transaction.get(orderRef);

      if (!orderSnapshot.exists() || orderSnapshot.data().status !== "pending") {
        throw new Error("Pedido já foi alterado.");
      }

      transaction.update(orderRef, {
        status: "rejected",
        adminId: currentUser.uid,
        rejectedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    setStatus("Pedido rejeitado.");
  } catch (error) {
    setStatus(error.message || "Não foi possível rejeitar o pedido.");
  }
};

googleLoginButton.addEventListener("click", async () => {
  setStatus("Abrindo login do Google...");
  setLoginBusy(true);

  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    if (error.code === "auth/popup-blocked" || error.code === "auth/operation-not-supported-in-this-environment") {
      await signInWithRedirect(auth, googleProvider);
      return;
    }

    if (error.code === "auth/popup-closed-by-user") {
      setStatus("Login cancelado. Toque em Entrar com Google para tentar novamente.");
    } else {
      setStatus("Não foi possível entrar com Google. Tente novamente.");
    }
  } finally {
    setLoginBusy(false);
  }
});

logoutButton.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  loginPanel.hidden = Boolean(user);
  sessionPanel.hidden = !user;
  ordersPanel.hidden = !user;
  setLoginBusy(false);

  if (unsubscribeOrders) {
    unsubscribeOrders();
    unsubscribeOrders = null;
  }

  if (!user) {
    orderList.innerHTML = "";
    updatePendingCount(0);
    setStatus("Entre com sua conta Google admin.");
    return;
  }

  adminName.textContent = user.displayName || "Admin";
  adminEmail.textContent = user.email || "Conta Google";

  if (user.photoURL) {
    adminAvatar.src = user.photoURL;
    adminAvatar.hidden = false;
  } else {
    adminAvatar.hidden = true;
  }

  const adminDoc = await getDoc(doc(db, "admins", user.uid));

  if (!adminDoc.exists()) {
    ordersPanel.hidden = true;
    updatePendingCount(0);
    setStatus(`Conta Google sem permissão de admin. UID: ${user.uid}`);
    return;
  }

  subscribeOrders();
});
