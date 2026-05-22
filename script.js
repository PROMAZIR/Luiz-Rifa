import { firebaseConfig } from "./firebase-config.js";

const raffleConfig = {
  ticketPrice: 20,
  holdMinutes: 30,
  startNumber: 2766,
  endNumber: 2800,
  drawDate: "25/09/2026",
  drawMethod: "Sistema de cumbuca",
  raffleLocation: "Colégio Estadual José Alves de Assis",
  prizeTitle: "Concorra a um iPhone 13",
  prizeDescription:
    "Ação entre formandos para ajudar nossa turma a realizar o sonho da formatura.",
  pixKey: "97287660172",
  pixKeyLabel: "CPF 972.876.601-72",
  receiverName: "RIFA FORMANDOS",
  receiverCity: "BRASIL",
  pixDescription: "RIFA FORMANDOS",
  whatsappNumber: "+5562981361884",
  reservedNumbers: [],
  soldTickets: [
    // { number: 2766, buyer: "Nome do comprador" },
  ],
};

const header = document.querySelector("[data-header]");
const menuToggle = document.querySelector("[data-menu-toggle]");
const nav = document.querySelector("[data-nav]");
const grid = document.querySelector("[data-number-grid]");
const selectedList = document.querySelector("[data-selected-list]");
const selectedTotal = document.querySelector("[data-selected-total]");
const pixTextarea = document.querySelector("[data-pix-code]");
const pixKey = document.querySelector("[data-pix-key]");
const pixQrCode = document.querySelector("[data-pix-qrcode]");
const pixQrStatus = document.querySelector("[data-pix-qr-status]");
const buyerName = document.querySelector("[data-buyer-name]");
const copyPixButton = document.querySelector("[data-copy-pix]");
const clearButton = document.querySelector("[data-clear-selection]");
const reserveButton = document.querySelector("[data-reserve-selection]");
const whatsAppLink = document.querySelector("[data-whatsapp-link]");
const panelStatus = document.querySelector("[data-panel-status]");
const firebaseStatus = document.querySelector("[data-firebase-status]");
const paymentTimer = document.querySelector("[data-payment-timer]");
const paymentCountdown = document.querySelector("[data-payment-countdown]");
const filterButtons = document.querySelectorAll("[data-filter]");
const availableCounter = document.querySelector("[data-available-counter]");
const ticketPriceLabels = document.querySelectorAll("[data-ticket-price]");
const raffleTotalLabels = document.querySelectorAll("[data-raffle-total]");
const drawDateLabels = document.querySelectorAll("[data-draw-date]");
const drawMethodLabels = document.querySelectorAll("[data-draw-method]");
const raffleLocationLabels = document.querySelectorAll("[data-raffle-location]");
const prizeTitle = document.querySelector("[data-prize-title]");
const prizeDescription = document.querySelector("[data-prize-description]");

const storageKey = `rifa-formandos-selected-${raffleConfig.startNumber}-${raffleConfig.endNumber}`;
const soldTicketMap = new Map(
  raffleConfig.soldTickets
    .map((ticket) => [Number(ticket.number), ticket.buyer?.trim() || "Vendido"])
    .filter(([number]) => Number.isInteger(number))
);
const soldNumbers = new Set(soldTicketMap.keys());
const reservedNumbers = new Set(raffleConfig.reservedNumbers);
let firestoreTicketMap = new Map();
let firestoreHoldMap = new Map();
let activeFilter = "all";
let selectedNumbers = new Set();
let currentPixCode = "";
let localPaymentHold = null;
const firebaseState = {
  app: null,
  auth: null,
  db: null,
  user: null,
  ready: false,
  unsubscribeTickets: null,
  unsubscribeHolds: null,
};
let firebaseApi = null;

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const holdDurationMs = raffleConfig.holdMinutes * 60 * 1000;

const getTotalNumbers = () => raffleConfig.endNumber - raffleConfig.startNumber + 1;

const formatNumber = (number) => String(number);

const timestampToMillis = (timestamp) => {
  if (!timestamp) return 0;
  if (typeof timestamp.toMillis === "function") return timestamp.toMillis();
  if (typeof timestamp.toDate === "function") return timestamp.toDate().getTime();
  if (timestamp instanceof Date) return timestamp.getTime();
  if (Number.isFinite(timestamp.seconds)) return timestamp.seconds * 1000;
  return 0;
};

const getRemainingMs = (expiresAt) => Math.max(0, timestampToMillis(expiresAt) - Date.now());

const formatCountdown = (milliseconds) => {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const isValidRaffleNumber = (number) =>
  Number.isInteger(number) && number >= raffleConfig.startNumber && number <= raffleConfig.endNumber;

const getRemoteTicket = (number) => firestoreTicketMap.get(number);

const isActiveHold = (hold) => hold?.status === "pending" && getRemainingMs(hold.expiresAt) > 0;

const getRemoteHold = (number) => {
  const hold = firestoreHoldMap.get(number);
  return isActiveHold(hold) ? hold : null;
};

const isOwnHold = (hold) => Boolean(firebaseState.user?.uid && hold?.ownerId === firebaseState.user.uid);

const getOwnActiveHoldEntries = () =>
  [...firestoreHoldMap.entries()]
    .filter(([, hold]) => isOwnHold(hold) && isActiveHold(hold))
    .sort(([firstNumber], [secondNumber]) => firstNumber - secondNumber);

const getActivePayment = () => {
  const ownHoldEntries = getOwnActiveHoldEntries();

  if (ownHoldEntries.length) {
    return {
      numbers: ownHoldEntries.map(([number]) => number),
      expiresAtMs: Math.min(...ownHoldEntries.map(([, hold]) => timestampToMillis(hold.expiresAt))),
      orderId: ownHoldEntries[0][1].orderId,
    };
  }

  if (
    localPaymentHold &&
    localPaymentHold.expiresAtMs > Date.now() &&
    localPaymentHold.numbers.every((number) => !getRemoteTicket(number))
  ) {
    return localPaymentHold;
  }

  return null;
};

const getCheckoutNumbers = () => {
  const activePayment = getActivePayment();
  const selection = getCheckoutNumbers();
  return selection.length ? selection : getActivePayment()?.numbers || [];
};

const isUnavailableNumber = (number) =>
  Boolean(getRemoteTicket(number)) ||
  Boolean(getRemoteHold(number)) ||
  soldNumbers.has(number) ||
  reservedNumbers.has(number);

const getNumberStatus = (number) => {
  const remoteTicket = getRemoteTicket(number);
  const remoteHold = getRemoteHold(number);

  if (remoteTicket) {
    return remoteTicket.status === "paid" || remoteTicket.status === "sold" ? "sold" : "reserved";
  }

  if (remoteHold) return "reserved";
  if (soldNumbers.has(number)) return "sold";
  if (reservedNumbers.has(number)) return "reserved";
  if (selectedNumbers.has(number)) return "selected";
  return "available";
};

const getTicketBuyerName = (number) => {
  const remoteTicket = getRemoteTicket(number);
  const remoteHold = getRemoteHold(number);

  if (remoteTicket?.buyerName) {
    return remoteTicket.buyerName;
  }

  if (remoteHold) {
    return isOwnHold(remoteHold) ? `Pague em ${formatCountdown(getRemainingMs(remoteHold.expiresAt))}` : "Em conferência";
  }

  if (soldTicketMap.has(number)) {
    return soldTicketMap.get(number);
  }

  if (reservedNumbers.has(number)) {
    return "Em conferência";
  }

  return "";
};

const getSortedSelection = () => [...selectedNumbers].sort((a, b) => a - b);

const syncHeader = () => {
  header.classList.toggle("is-scrolled", window.scrollY > 20);
};

const closeMenu = () => {
  nav.classList.remove("is-open");
  header.classList.remove("is-open");
  menuToggle.setAttribute("aria-expanded", "false");
};

const saveSelection = () => {
  try {
    localStorage.setItem(storageKey, JSON.stringify(getSortedSelection()));
  } catch {
    // Local storage can be unavailable in private contexts.
  }
};

const loadSelection = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
    selectedNumbers = new Set(
      saved.filter((number) => {
        return isValidRaffleNumber(number) && !isUnavailableNumber(number);
      })
    );
  } catch {
    selectedNumbers = new Set();
  }
};

const reconcileSelection = () => {
  let changed = false;

  selectedNumbers.forEach((number) => {
    if (!isValidRaffleNumber(number) || isUnavailableNumber(number)) {
      selectedNumbers.delete(number);
      changed = true;
    }
  });

  if (changed) {
    saveSelection();
  }
};

const shouldShowNumber = (status) => {
  if (activeFilter === "all") return true;
  return status === activeFilter;
};

const createNumberButton = (number) => {
  const status = getNumberStatus(number);
  const button = document.createElement("button");
  const labelStatus = {
    available: "livre",
    selected: "escolhido",
    reserved: "reservado",
    sold: "vendido",
  }[status];

  button.type = "button";
  button.className = `number-button is-${status}`;
  button.dataset.number = String(number);
  button.dataset.status = status;
  button.setAttribute("aria-label", `Número ${formatNumber(number)} ${labelStatus}`);

  const numberValue = document.createElement("span");
  numberValue.className = "number-value";
  numberValue.textContent = formatNumber(number);

  if (status === "sold" || status === "reserved") {
    const buyerName = getTicketBuyerName(number) || labelStatus;
    const buyer = document.createElement("span");
    buyer.className = "buyer-name";
    buyer.textContent = buyerName;
    button.title = `Número ${formatNumber(number)} ${labelStatus} para ${buyerName}`;
    button.setAttribute("aria-label", `Número ${formatNumber(number)} ${labelStatus} para ${buyerName}`);
    button.append(buyer, numberValue);
  } else {
    button.append(numberValue);
  }

  if (status === "available" || status === "selected") {
    button.setAttribute("aria-pressed", String(status === "selected"));
  } else {
    button.disabled = true;
  }

  return button;
};

const updateAvailableCounter = () => {
  const activeHoldNumbers = [...firestoreHoldMap.entries()]
    .filter(([, hold]) => isActiveHold(hold))
    .map(([number]) => number);
  const unavailableNumbers = new Set(
    [...soldNumbers, ...reservedNumbers, ...firestoreTicketMap.keys(), ...activeHoldNumbers].filter(isValidRaffleNumber)
  );
  const unavailableCount = unavailableNumbers.size;
  const selectedCount = selectedNumbers.size;
  const availableCount = getTotalNumbers() - unavailableCount - selectedCount;
  availableCounter.textContent = `${availableCount} livres`;
};

const renderNumberGrid = () => {
  grid.innerHTML = "";
  grid.classList.remove("is-empty");

  let rendered = 0;

  for (let number = raffleConfig.startNumber; number <= raffleConfig.endNumber; number += 1) {
    const status = getNumberStatus(number);

    if (!shouldShowNumber(status)) {
      continue;
    }

    grid.append(createNumberButton(number));
    rendered += 1;
  }

  if (!rendered) {
    grid.classList.add("is-empty");
    const empty = document.createElement("p");
    empty.className = "empty-filter";
    empty.textContent = "Nenhum número encontrado neste filtro.";
    grid.append(empty);
  }

  updateAvailableCounter();
};

const emv = (id, value) => `${id}${String(value.length).padStart(2, "0")}${value}`;

const normalizePixText = (value, maxLength) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 $%*+\-./:]/g, "")
    .trim()
    .slice(0, maxLength);

const crc16Pix = (payload) => {
  let crc = 0xffff;

  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, "0");
};

const buildPixDescription = (selection) => {
  const list = selection.map(formatNumber).join(" ");
  const description = list.length <= 56 ? `RIFA ${list}` : `RIFA ${selection.length} NUMEROS`;
  return normalizePixText(description, 72);
};

const buildPixTxid = (selection) => {
  const firstNumber = selection[0] || raffleConfig.startNumber;
  const lastNumber = selection.at(-1) || firstNumber;
  return normalizePixText(`RF${selection.length}${firstNumber}${lastNumber}`, 25).replace(/[^A-Z0-9]/g, "");
};

const buildPixPayload = (total, selection) => {
  const merchantAccountInfo = [
    emv("00", "br.gov.bcb.pix"),
    emv("01", raffleConfig.pixKey.replace(/\D/g, "")),
    emv("02", buildPixDescription(selection)),
  ].join("");

  const payloadWithoutCrc = [
    emv("00", "01"),
    emv("01", "11"),
    emv("26", merchantAccountInfo),
    emv("52", "0000"),
    emv("53", "986"),
    emv("54", total.toFixed(2)),
    emv("58", "BR"),
    emv("59", normalizePixText(raffleConfig.receiverName, 25) || "RIFA FORMANDOS"),
    emv("60", normalizePixText(raffleConfig.receiverCity, 15) || "BRASIL"),
    emv("62", emv("05", buildPixTxid(selection) || "***")),
    "6304",
  ].join("");

  return `${payloadWithoutCrc}${crc16Pix(payloadWithoutCrc)}`;
};

const QR_VERSION = 10;
const QR_SIZE = 17 + QR_VERSION * 4;
const QR_DATA_CODEWORDS = 274;
const QR_EC_CODEWORDS_PER_BLOCK = 18;
const QR_DATA_BLOCK_LENGTHS = [68, 68, 69, 69];
const QR_MASK = 0;

const qrGf = (() => {
  const exp = new Array(512).fill(0);
  const log = new Array(256).fill(0);
  let value = 1;

  for (let i = 0; i < 255; i += 1) {
    exp[i] = value;
    log[value] = i;
    value <<= 1;

    if (value & 0x100) {
      value ^= 0x11d;
    }
  }

  for (let i = 255; i < exp.length; i += 1) {
    exp[i] = exp[i - 255];
  }

  return { exp, log };
})();

const qrGfMultiply = (x, y) => {
  if (x === 0 || y === 0) {
    return 0;
  }

  return qrGf.exp[qrGf.log[x] + qrGf.log[y]];
};

const qrReedSolomonDivisor = (degree) => {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;

  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = qrGfMultiply(result[j], root);

      if (j + 1 < result.length) {
        result[j] ^= result[j + 1];
      }
    }

    root = qrGfMultiply(root, 0x02);
  }

  return result;
};

const qrReedSolomonRemainder = (data, divisor) => {
  const result = new Array(divisor.length).fill(0);

  data.forEach((byte) => {
    const factor = byte ^ result.shift();
    result.push(0);

    divisor.forEach((coefficient, index) => {
      result[index] ^= qrGfMultiply(coefficient, factor);
    });
  });

  return result;
};

const appendBits = (bits, value, length) => {
  for (let i = length - 1; i >= 0; i -= 1) {
    bits.push((value >>> i) & 1);
  }
};

const makeQrDataCodewords = (text) => {
  const bytes = [...text].map((char) => char.charCodeAt(0));
  const bits = [];
  const capacityBits = QR_DATA_CODEWORDS * 8;

  if (bytes.length > 271) {
    throw new Error("Código Pix muito longo para o QR Code configurado.");
  }

  appendBits(bits, 0x4, 4);
  appendBits(bits, bytes.length, 16);
  bytes.forEach((byte) => appendBits(bits, byte, 8));
  appendBits(bits, 0, Math.min(4, capacityBits - bits.length));

  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  const codewords = [];

  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(Number.parseInt(bits.slice(i, i + 8).join(""), 2));
  }

  for (let pad = 0xec; codewords.length < QR_DATA_CODEWORDS; pad ^= 0xfd) {
    codewords.push(pad);
  }

  return codewords;
};

const makeQrCodewords = (text) => {
  const dataCodewords = makeQrDataCodewords(text);
  const divisor = qrReedSolomonDivisor(QR_EC_CODEWORDS_PER_BLOCK);
  const blocks = [];
  let offset = 0;

  QR_DATA_BLOCK_LENGTHS.forEach((length) => {
    const data = dataCodewords.slice(offset, offset + length);
    offset += length;
    blocks.push({ data, errorCorrection: qrReedSolomonRemainder(data, divisor) });
  });

  const result = [];
  const maxBlockLength = Math.max(...QR_DATA_BLOCK_LENGTHS);

  for (let i = 0; i < maxBlockLength; i += 1) {
    blocks.forEach((block) => {
      if (i < block.data.length) {
        result.push(block.data[i]);
      }
    });
  }

  for (let i = 0; i < QR_EC_CODEWORDS_PER_BLOCK; i += 1) {
    blocks.forEach((block) => result.push(block.errorCorrection[i]));
  }

  return result;
};

const getQrBit = (value, index) => ((value >>> index) & 1) !== 0;

const makeQrMatrix = (text) => {
  const modules = Array.from({ length: QR_SIZE }, () => new Array(QR_SIZE).fill(false));
  const isFunction = Array.from({ length: QR_SIZE }, () => new Array(QR_SIZE).fill(false));
  const inBounds = (x, y) => x >= 0 && x < QR_SIZE && y >= 0 && y < QR_SIZE;
  const setFunction = (x, y, dark) => {
    if (!inBounds(x, y)) {
      return;
    }

    modules[y][x] = dark;
    isFunction[y][x] = true;
  };

  const drawFinder = (centerX, centerY) => {
    for (let y = -4; y <= 4; y += 1) {
      for (let x = -4; x <= 4; x += 1) {
        const distance = Math.max(Math.abs(x), Math.abs(y));
        setFunction(centerX + x, centerY + y, distance !== 2 && distance !== 4);
      }
    }
  };

  const drawAlignment = (centerX, centerY) => {
    for (let y = -2; y <= 2; y += 1) {
      for (let x = -2; x <= 2; x += 1) {
        setFunction(centerX + x, centerY + y, Math.max(Math.abs(x), Math.abs(y)) !== 1);
      }
    }
  };

  const drawFormatBits = () => {
    const data = (1 << 3) | QR_MASK;
    let remainder = data;

    for (let i = 0; i < 10; i += 1) {
      remainder = (remainder << 1) ^ (((remainder >>> 9) & 1) ? 0x537 : 0);
    }

    const bits = ((data << 10) | remainder) ^ 0x5412;

    for (let i = 0; i <= 5; i += 1) setFunction(8, i, getQrBit(bits, i));
    setFunction(8, 7, getQrBit(bits, 6));
    setFunction(8, 8, getQrBit(bits, 7));
    setFunction(7, 8, getQrBit(bits, 8));

    for (let i = 9; i < 15; i += 1) setFunction(14 - i, 8, getQrBit(bits, i));
    for (let i = 0; i < 8; i += 1) setFunction(QR_SIZE - 1 - i, 8, getQrBit(bits, i));
    for (let i = 8; i < 15; i += 1) setFunction(8, QR_SIZE - 15 + i, getQrBit(bits, i));

    setFunction(8, QR_SIZE - 8, true);
  };

  const drawVersionBits = () => {
    let remainder = QR_VERSION;

    for (let i = 0; i < 12; i += 1) {
      remainder = (remainder << 1) ^ (((remainder >>> 11) & 1) ? 0x1f25 : 0);
    }

    const bits = (QR_VERSION << 12) | remainder;

    for (let i = 0; i < 18; i += 1) {
      const bit = getQrBit(bits, i);
      const a = QR_SIZE - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunction(a, b, bit);
      setFunction(b, a, bit);
    }
  };

  drawFinder(3, 3);
  drawFinder(QR_SIZE - 4, 3);
  drawFinder(3, QR_SIZE - 4);

  for (let i = 0; i < QR_SIZE; i += 1) {
    if (!isFunction[6][i]) setFunction(i, 6, i % 2 === 0);
    if (!isFunction[i][6]) setFunction(6, i, i % 2 === 0);
  }

  [6, 28, 50].forEach((y) => {
    [6, 28, 50].forEach((x) => {
      const overlapsFinder =
        (x === 6 && y === 6) || (x === QR_SIZE - 7 && y === 6) || (x === 6 && y === QR_SIZE - 7);

      if (!overlapsFinder) {
        drawAlignment(x, y);
      }
    });
  });

  drawFormatBits();
  drawVersionBits();

  const codewords = makeQrCodewords(text);
  let bitIndex = 0;
  let upward = true;

  for (let right = QR_SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) {
      right -= 1;
    }

    for (let vertical = 0; vertical < QR_SIZE; vertical += 1) {
      const y = upward ? QR_SIZE - 1 - vertical : vertical;

      for (let columnOffset = 0; columnOffset < 2; columnOffset += 1) {
        const x = right - columnOffset;

        if (isFunction[y][x]) {
          continue;
        }

        let dark = false;

        if (bitIndex < codewords.length * 8) {
          dark = getQrBit(codewords[Math.floor(bitIndex / 8)], 7 - (bitIndex % 8));
        }

        if ((x + y) % 2 === 0) {
          dark = !dark;
        }

        modules[y][x] = dark;
        bitIndex += 1;
      }
    }

    upward = !upward;
  }

  drawFormatBits();

  return modules;
};

const createQrSvg = (text) => {
  const quietZone = 4;
  const modules = makeQrMatrix(text);
  const size = modules.length + quietZone * 2;
  const path = [];

  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) {
        path.push(`M${x + quietZone},${y + quietZone}h1v1h-1z`);
      }
    });
  });

  return `
    <svg viewBox="0 0 ${size} ${size}" role="img" aria-label="QR Code Pix" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" fill="#fff" />
      <path d="${path.join("")}" fill="#111" />
    </svg>
  `;
};

const renderPixQr = (pixCode) => {
  if (!pixCode) {
    pixQrCode.innerHTML = "<span>QR Code Pix</span>";
    pixQrStatus.textContent = "Selecione um número para gerar o QR Code Pix.";
    return;
  }

  try {
    pixQrCode.innerHTML = createQrSvg(pixCode);
    pixQrStatus.textContent = "Escaneie o QR Code ou copie o código Pix abaixo.";
  } catch {
    pixQrCode.innerHTML = "<span>QR indisponível</span>";
    pixQrStatus.textContent = "Não foi possível renderizar o QR Code. Use o Pix copia e cola.";
  }
};

const buildWhatsAppMessage = () => {
  const checkoutNumbers = getCheckoutNumbers();
  const selection = checkoutNumbers.map(formatNumber).join(", ");
  const name = buyerName.value.trim();
  const total = currency.format(checkoutNumbers.length * raffleConfig.ticketPrice);

  return [
    "Olá! Já paguei número(s) da Rifa dos Formandos do 3º Ano.",
    name ? `Nome: ${name}` : "",
    `Número(s): ${selection}`,
    `Total: ${total}`,
    `Prêmio: ${raffleConfig.prizeTitle}`,
    `Chave Pix: ${raffleConfig.pixKeyLabel}`,
    "Envio o comprovante por aqui.",
  ]
    .filter(Boolean)
    .join("\n");
};

const buildWhatsAppUrl = () =>
  `https://wa.me/${raffleConfig.whatsappNumber.replace(/\D/g, "")}?text=${encodeURIComponent(buildWhatsAppMessage())}`;

const updateWhatsAppLink = () => {
  const hasNumbers = getCheckoutNumbers().length > 0;
  whatsAppLink.href = hasNumbers ? buildWhatsAppUrl() : "#";
  whatsAppLink.classList.toggle("is-disabled", !hasNumbers);
  whatsAppLink.setAttribute("aria-disabled", String(!hasNumbers));
  whatsAppLink.tabIndex = hasNumbers ? 0 : -1;
};

const updateSelectedList = () => {
  selectedList.innerHTML = "";

  const selection = getSortedSelection();

  if (!selection.length) {
    const empty = document.createElement("em");
    empty.textContent = "Nenhum número escolhido";
    selectedList.append(empty);
    return;
  }

  selection.forEach((number) => {
    const chip = document.createElement("span");
    chip.className = `selected-chip${activePayment && !selectedNumbers.size ? " is-held" : ""}`;
    chip.textContent = formatNumber(number);
    selectedList.append(chip);
  });
};

const updatePaymentTimer = (activePayment) => {
  if (!paymentTimer || !paymentCountdown) {
    return;
  }

  if (!activePayment) {
    paymentTimer.hidden = true;
    return;
  }

  paymentTimer.hidden = false;
  paymentCountdown.textContent = formatCountdown(activePayment.expiresAtMs - Date.now());
};

const updateCheckout = () => {
  const hasSelection = selectedNumbers.size > 0;
  const activePayment = getActivePayment();
  const checkoutNumbers = getCheckoutNumbers();
  const hasCheckoutNumbers = checkoutNumbers.length > 0;
  const total = checkoutNumbers.length * raffleConfig.ticketPrice;
  currentPixCode = hasCheckoutNumbers ? buildPixPayload(total, checkoutNumbers) : "";

  updateSelectedList();
  selectedTotal.textContent = currency.format(total);
  pixTextarea.value = currentPixCode;
  pixKey.textContent = raffleConfig.pixKeyLabel;
  copyPixButton.disabled = !hasCheckoutNumbers;
  clearButton.disabled = !hasSelection;
  renderPixQr(currentPixCode);
  updatePaymentTimer(activePayment);
  updateWhatsAppLink();
  updateReserveButton();

  if (activePayment && !hasSelection) {
    panelStatus.textContent = "Números bloqueados por 30 minutos. Pague o Pix e aguarde o admin confirmar.";
  } else if (!hasSelection) {
    panelStatus.textContent = "Selecione um número livre para liberar o Pix.";
  }
};

const setStatus = (message) => {
  panelStatus.textContent = message;
};

const setFirebaseStatus = (message) => {
  firebaseStatus.textContent = message;
};

const isFirebaseConfigured = () =>
  Boolean(firebaseConfig?.apiKey) &&
  Boolean(firebaseConfig?.projectId) &&
  !String(firebaseConfig.apiKey).includes("COLE_") &&
  !String(firebaseConfig.projectId).includes("COLE_");

const updateReserveButton = () => {
  const hasSelection = selectedNumbers.size > 0;
  const hasName = buyerName.value.trim().length >= 2;
  const activePayment = getActivePayment();
  reserveButton.textContent = activePayment ? "Aguardando confirmação" : `Bloquear por ${raffleConfig.holdMinutes} min`;
  reserveButton.disabled = !(firebaseState.ready && hasSelection && hasName && !activePayment);
};

const toggleNumber = (number) => {
  if (getActivePayment() && !selectedNumbers.has(number)) {
    setStatus("Você já tem números bloqueados. Finalize o pagamento ou aguarde o prazo terminar.");
    return;
  }

  if (isUnavailableNumber(number)) {
    setStatus(`Número ${formatNumber(number)} já está vendido ou em conferência.`);
    return;
  }

  if (selectedNumbers.has(number)) {
    selectedNumbers.delete(number);
    setStatus(`Número ${formatNumber(number)} removido da escolha.`);
  } else {
    selectedNumbers.add(number);
    setStatus(`Número ${formatNumber(number)} escolhido. O Pix já está liberado.`);
  }

  saveSelection();
  renderNumberGrid();
  updateCheckout();
};

const copyText = async (text) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  pixTextarea.focus();
  pixTextarea.select();
  document.execCommand("copy");
};

const hydrateStaticText = () => {
  ticketPriceLabels.forEach((label) => {
    label.textContent = currency.format(raffleConfig.ticketPrice);
  });

  raffleTotalLabels.forEach((label) => {
    label.textContent = String(getTotalNumbers());
  });

  drawDateLabels.forEach((label) => {
    label.textContent = raffleConfig.drawDate;
  });

  drawMethodLabels.forEach((label) => {
    label.textContent = raffleConfig.drawMethod;
  });

  raffleLocationLabels.forEach((label) => {
    label.textContent = raffleConfig.raffleLocation;
  });

  prizeTitle.textContent = raffleConfig.prizeTitle;
  prizeDescription.textContent = raffleConfig.prizeDescription;
};

const subscribeToTickets = () => {
  if (firebaseState.unsubscribeTickets) {
    firebaseState.unsubscribeTickets();
  }

  firebaseState.unsubscribeTickets = firebaseApi.onSnapshot(
    firebaseApi.collection(firebaseState.db, "tickets"),
    (snapshot) => {
      const nextTickets = new Map();

      snapshot.forEach((ticketDoc) => {
        const ticket = ticketDoc.data();
        const number = Number(ticket.number ?? ticketDoc.id);

        if (isValidRaffleNumber(number)) {
          nextTickets.set(number, {
            buyerName: String(ticket.buyerName || "Vendido").slice(0, 80),
            status: ticket.status || "reserved",
          });
        }
      });

      firestoreTicketMap = nextTickets;
      reconcileSelection();
      renderNumberGrid();
      updateCheckout();
      setFirebaseStatus("Sistema de pedidos conectado.");
    },
    () => {
      setFirebaseStatus("Não foi possível ler as reservas. Verifique as regras do Firebase.");
    }
  );
};

const subscribeToHolds = () => {
  if (firebaseState.unsubscribeHolds) {
    firebaseState.unsubscribeHolds();
  }

  firebaseState.unsubscribeHolds = firebaseApi.onSnapshot(
    firebaseApi.collection(firebaseState.db, "holds"),
    (snapshot) => {
      const nextHolds = new Map();

      snapshot.forEach((holdDoc) => {
        const hold = holdDoc.data();
        const number = Number(hold.number ?? holdDoc.id);

        if (isValidRaffleNumber(number) && hold.status === "pending") {
          nextHolds.set(number, {
            ownerId: hold.ownerId,
            orderId: hold.orderId,
            status: hold.status,
            expiresAt: hold.expiresAt,
          });
        }
      });

      if (
        localPaymentHold &&
        ![...nextHolds.values()].some((hold) => hold.orderId === localPaymentHold.orderId && isActiveHold(hold))
      ) {
        localPaymentHold = null;
      }

      firestoreHoldMap = nextHolds;
      reconcileSelection();
      renderNumberGrid();
      updateCheckout();
      setFirebaseStatus("Sistema de pedidos conectado.");
    },
    () => {
      setFirebaseStatus("Não foi possível ler os bloqueios temporários. Verifique as regras do Firebase.");
    }
  );
};

const initFirebase = async () => {
  if (!isFirebaseConfigured()) {
    firebaseState.ready = false;
    setFirebaseStatus("Firebase aguardando configuração em firebase-config.js.");
    updateReserveButton();
    return;
  }

  try {
    if (!firebaseApi) {
      const [appModule, authModule, firestoreModule] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js"),
        import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js"),
      ]);

      firebaseApi = {
        addDoc: firestoreModule.addDoc,
        initializeApp: appModule.initializeApp,
        getAuth: authModule.getAuth,
        onAuthStateChanged: authModule.onAuthStateChanged,
        signInAnonymously: authModule.signInAnonymously,
        collection: firestoreModule.collection,
        doc: firestoreModule.doc,
        getFirestore: firestoreModule.getFirestore,
        onSnapshot: firestoreModule.onSnapshot,
        runTransaction: firestoreModule.runTransaction,
        serverTimestamp: firestoreModule.serverTimestamp,
        Timestamp: firestoreModule.Timestamp,
      };
    }

    firebaseState.app = firebaseApi.initializeApp(firebaseConfig);
    firebaseState.auth = firebaseApi.getAuth(firebaseState.app);
    firebaseState.db = firebaseApi.getFirestore(firebaseState.app);

    firebaseApi.onAuthStateChanged(firebaseState.auth, (user) => {
      firebaseState.user = user;
      firebaseState.ready = Boolean(user);

      if (user) {
        setFirebaseStatus("Usuário conectado. Pedidos protegidos por conta.");
        subscribeToTickets();
        subscribeToHolds();
      } else {
        setFirebaseStatus("Conectando usuário...");
      }

      updateReserveButton();
    });

    await firebaseApi.signInAnonymously(firebaseState.auth);
  } catch {
    firebaseState.ready = false;
    setFirebaseStatus("Falha ao conectar no Firebase. Confira a configuração do projeto.");
    updateReserveButton();
  }
};

const reserveSelectedTickets = async () => {
  const selection = getSortedSelection();
  const name = buyerName.value.trim();
  const total = selection.length * raffleConfig.ticketPrice;
  const activePayment = getActivePayment();

  if (!firebaseState.ready || !firebaseState.db || !firebaseState.user) {
    setStatus("Configure e conecte o Firebase antes de enviar o pedido.");
    return;
  }

  if (!selection.length) {
    setStatus("Selecione pelo menos um número livre.");
    return;
  }

  if (name.length < 2) {
    setStatus("Informe seu nome para enviar o pedido.");
    buyerName.focus();
    updateReserveButton();
    return;
  }

  if (activePayment) {
    setStatus("Você já tem números bloqueados. Pague dentro do prazo ou aguarde liberar.");
    return;
  }

  const txid = buildPixTxid(selection);
  const numberMap = Object.fromEntries(selection.map((number) => [String(number), true]));
  const expiresAtMs = Date.now() + holdDurationMs;
  const expiresAt = firebaseApi.Timestamp.fromDate(new Date(expiresAtMs));
  let createdOrderId = "";

  try {
    await firebaseApi.runTransaction(firebaseState.db, async (transaction) => {
      const orderRef = firebaseApi.doc(firebaseApi.collection(firebaseState.db, "orders"));
      const ticketRefs = selection.map((number) => firebaseApi.doc(firebaseState.db, "tickets", String(number)));
      const holdRefs = selection.map((number) => firebaseApi.doc(firebaseState.db, "holds", String(number)));
      const ticketSnapshots = [];
      const holdSnapshots = [];

      for (const ticketRef of ticketRefs) {
        ticketSnapshots.push(await transaction.get(ticketRef));
      }

      for (const holdRef of holdRefs) {
        holdSnapshots.push(await transaction.get(holdRef));
      }

      ticketSnapshots.forEach((ticketSnapshot, index) => {
        if (ticketSnapshot.exists()) {
          throw new Error(`Número ${formatNumber(selection[index])} já está vendido.`);
        }
      });

      holdSnapshots.forEach((holdSnapshot, index) => {
        if (holdSnapshot.exists() && isActiveHold(holdSnapshot.data())) {
          throw new Error(`Número ${formatNumber(selection[index])} está bloqueado para pagamento.`);
        }
      });

      createdOrderId = orderRef.id;

      transaction.set(orderRef, {
        buyerName: name.slice(0, 80),
        ownerId: firebaseState.user.uid,
        status: "pending",
        numberMap,
        numbersText: selection.map(formatNumber).join(", "),
        ticketCount: selection.length,
        amountCents: total * 100,
        ticketPriceCents: raffleConfig.ticketPrice * 100,
        txid,
        expiresAt,
        createdAt: firebaseApi.serverTimestamp(),
        updatedAt: firebaseApi.serverTimestamp(),
      });

      holdRefs.forEach((holdRef, index) => {
        transaction.set(holdRef, {
          number: selection[index],
          ownerId: firebaseState.user.uid,
          orderId: createdOrderId,
          status: "pending",
          expiresAt,
          createdAt: firebaseApi.serverTimestamp(),
          updatedAt: firebaseApi.serverTimestamp(),
        });
      });
    });

    localPaymentHold = { numbers: selection, expiresAtMs, orderId: createdOrderId };
    selectedNumbers.clear();
    saveSelection();
    renderNumberGrid();
    updateCheckout();
    setStatus("Números bloqueados por 30 minutos. Pague o Pix e aguarde o admin confirmar.");
  } catch (error) {
    setStatus(error.message || "Não foi possível bloquear os números. Tente novamente.");
  }
};

syncHeader();
loadSelection();
hydrateStaticText();
renderNumberGrid();
updateCheckout();
initFirebase();

window.addEventListener("scroll", syncHeader, { passive: true });

window.setInterval(() => {
  renderNumberGrid();
  updateCheckout();
}, 1000);

menuToggle.addEventListener("click", () => {
  const isOpen = nav.classList.toggle("is-open");
  header.classList.toggle("is-open", isOpen);
  menuToggle.setAttribute("aria-expanded", String(isOpen));
});

nav.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", closeMenu);
});

grid.addEventListener("click", (event) => {
  const button = event.target.closest(".number-button");

  if (!button || button.disabled) {
    return;
  }

  toggleNumber(Number(button.dataset.number));
});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    filterButtons.forEach((filter) => filter.classList.remove("is-active"));
    button.classList.add("is-active");
    activeFilter = button.dataset.filter;
    renderNumberGrid();
  });
});

buyerName.addEventListener("input", () => {
  updateWhatsAppLink();
  updateReserveButton();
});

reserveButton.addEventListener("click", reserveSelectedTickets);

copyPixButton.addEventListener("click", async () => {
  try {
    await copyText(currentPixCode);
    setStatus("Pix copiado. Depois do pagamento, envie o pedido para conferência.");
  } catch {
    setStatus("Não foi possível copiar automaticamente. Selecione o código Pix e copie manualmente.");
  }
});

clearButton.addEventListener("click", () => {
  selectedNumbers.clear();
  saveSelection();
  renderNumberGrid();
  updateCheckout();
  setStatus("Escolha limpa. Selecione novos números para continuar.");
});

whatsAppLink.addEventListener("click", (event) => {
  if (!getCheckoutNumbers().length) {
    event.preventDefault();
  }
});

const revealItems = document.querySelectorAll(".reveal");

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.14 }
  );

  revealItems.forEach((item) => observer.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}
