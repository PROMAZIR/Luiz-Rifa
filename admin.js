import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
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

const loginForm = document.querySelector("[data-admin-login]");
const emailInput = document.querySelector("[data-admin-email]");
const passwordInput = document.querySelector("[data-admin-password]");
const sessionPanel = document.querySelector("[data-admin-session]");
const ordersPanel = document.querySelector("[data-admin-orders]");
const orderList = document.querySelector("[data-order-list]");
const adminStatus = document.querySelector("[data-admin-status]");
const logoutButton = document.querySelector("[data-admin-logout]");

let currentUser = null;
let unsubscribeOrders = null;

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const setStatus = (message) => {
  adminStatus.textContent = message;
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

const renderOrders = (orders) => {
  orderList.innerHTML = "";

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
    header.innerHTML = `
      <div>
        <strong>${data.buyerName || "Sem nome"}</strong>
        <span>${formatDate(data.createdAt)}</span>
      </div>
      <b>${currency.format((data.amountCents || 0) / 100)}</b>
    `;

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
      setStatus(`Conectado como ${currentUser.email}.`);
    },
    () => {
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

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Entrando...");

  try {
    await signInWithEmailAndPassword(auth, emailInput.value.trim(), passwordInput.value);
    passwordInput.value = "";
  } catch {
    setStatus("Falha no login. Confira email e senha.");
  }
});

logoutButton.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  loginForm.hidden = Boolean(user);
  sessionPanel.hidden = !user;
  ordersPanel.hidden = !user;

  if (unsubscribeOrders) {
    unsubscribeOrders();
    unsubscribeOrders = null;
  }

  if (!user) {
    orderList.innerHTML = "";
    setStatus("Entre com o usuário admin.");
    return;
  }

  const adminDoc = await getDoc(doc(db, "admins", user.uid));

  if (!adminDoc.exists()) {
    setStatus(`Usuário sem permissão de admin. UID: ${user.uid}`);
    return;
  }

  subscribeOrders();
});
