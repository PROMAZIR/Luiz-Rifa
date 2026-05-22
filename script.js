import { firebaseConfig } from "./firebase-config.js";

const raffleConfig = {
  ticketPrice: 20,
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
let activeFilter = "all";
let selectedNumbers = new Set();
let currentPixCode = "";
const firebaseState = {
  app: null,
  auth: null,
  db: null,
  user: null,
  ready: false,
  unsubscribeTickets: null,
};
let firebaseApi = null;

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const getTotalNumbers = () => raffleConfig.endNumber - raffleConfig.startNumber + 1;

const formatNumber = (number) => String(number);

const isValidRaffleNumber = (number) =>
  Number.isInteger(number) && number >= raffleConfig.startNumber && number <= raffleConfig.endNumber;

const getRemoteTicket = (number) => firestoreTicketMap.get(number);

const isUnavailableNumber = (number) =>
  Boolean(getRemoteTicket(number)) || soldNumbers.has(number) || reservedNumbers.has(number);

const getNumberStatus = (number) => {
  const remoteTicket = getRemoteTicket(number);

  if (remoteTicket) {
    return remoteTicket.status === "paid" || remoteTicket.status === "sold" ? "sold" : "reserved";
  }

  if (soldNumbers.has(number)) return "sold";
  if (reservedNumbers.has(number)) return "reserved";
  if (selectedNumbers.has(number)) return "selected";
  return "available";
};

const getTicketBuyerName = (number) => {
  const remoteTicket = getRemoteTicket(number);

  if (remoteTicket?.buyerName) {
    return remoteTicket.buyerName;
  }

  if (soldTicketMap.has(number)) {
    return soldTicketMap.get(number);
  }

  if (reservedNumbers.has(number)) {
    return "Reservado";
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
  const unavailableNumbers = new Set(
    [...soldNumbers, ...reservedNumbers, ...firestoreTicketMap.keys()].filter(isValidRaffleNumber)
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
  const selection = getSortedSelection().map(formatNumber).join(", ");
  const name = buyerName.value.trim();
  const total = currency.format(selectedNumbers.size * raffleConfig.ticketPrice);

  return [
    "Olá! Quero reservar número(s) da Rifa dos Formandos do 3º Ano.",
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
  const hasSelection = selectedNumbers.size > 0;
  whatsAppLink.href = hasSelection ? buildWhatsAppUrl() : "#";
  whatsAppLink.classList.toggle("is-disabled", !hasSelection);
  whatsAppLink.setAttribute("aria-disabled", String(!hasSelection));
  whatsAppLink.tabIndex = hasSelection ? 0 : -1;
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
    chip.className = "selected-chip";
    chip.textContent = formatNumber(number);
    selectedList.append(chip);
  });
};

const updateCheckout = () => {
  const hasSelection = selectedNumbers.size > 0;
  const selection = getSortedSelection();
  const total = selectedNumbers.size * raffleConfig.ticketPrice;
  currentPixCode = hasSelection ? buildPixPayload(total, selection) : "";

  updateSelectedList();
  selectedTotal.textContent = currency.format(total);
  pixTextarea.value = currentPixCode;
  pixKey.textContent = raffleConfig.pixKeyLabel;
  copyPixButton.disabled = !hasSelection;
  clearButton.disabled = !hasSelection;
  renderPixQr(currentPixCode);
  updateWhatsAppLink();
  updateReserveButton();

  if (!hasSelection) {
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
  reserveButton.disabled = !(firebaseState.ready && hasSelection && hasName);
};

const toggleNumber = (number) => {
  if (isUnavailableNumber(number)) {
    setStatus(`Número ${formatNumber(number)} já está reservado.`);
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
            buyerName: String(ticket.buyerName || "Reservado").slice(0, 80),
            ownerId: ticket.ownerId,
            status: ticket.status || "reserved",
          });
        }
      });

      firestoreTicketMap = nextTickets;
      reconcileSelection();
      renderNumberGrid();
      updateCheckout();
      setFirebaseStatus("Sistema de reservas conectado.");
    },
    () => {
      setFirebaseStatus("Não foi possível ler as reservas. Verifique as regras do Firebase.");
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
      };
    }

    firebaseState.app = firebaseApi.initializeApp(firebaseConfig);
    firebaseState.auth = firebaseApi.getAuth(firebaseState.app);
    firebaseState.db = firebaseApi.getFirestore(firebaseState.app);

    firebaseApi.onAuthStateChanged(firebaseState.auth, (user) => {
      firebaseState.user = user;
      firebaseState.ready = Boolean(user);

      if (user) {
        setFirebaseStatus("Usuário conectado. Reservas protegidas por conta.");
        subscribeToTickets();
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

  if (!firebaseState.ready || !firebaseState.db || !firebaseState.user) {
    setStatus("Configure e conecte o Firebase antes de reservar no sistema.");
    return;
  }

  if (!selection.length) {
    setStatus("Selecione pelo menos um número livre.");
    return;
  }

  if (name.length < 2) {
    setStatus("Informe seu nome para registrar a reserva.");
    buyerName.focus();
    updateReserveButton();
    return;
  }

  const reservationId = buildPixTxid(selection);

  try {
    await firebaseApi.runTransaction(firebaseState.db, async (transaction) => {
      const refs = selection.map((number) => firebaseApi.doc(firebaseState.db, "tickets", String(number)));
      const docs = [];

      for (const ticketRef of refs) {
        docs.push(await transaction.get(ticketRef));
      }

      docs.forEach((ticketSnapshot, index) => {
        if (ticketSnapshot.exists()) {
          throw new Error(`O número ${formatNumber(selection[index])} já foi reservado.`);
        }
      });

      refs.forEach((ticketRef, index) => {
        transaction.set(ticketRef, {
          number: selection[index],
          buyerName: name.slice(0, 80),
          ownerId: firebaseState.user.uid,
          status: "reserved",
          amountCents: raffleConfig.ticketPrice * 100,
          reservationId,
          createdAt: firebaseApi.serverTimestamp(),
          updatedAt: firebaseApi.serverTimestamp(),
        });
      });
    });

    selectedNumbers.clear();
    saveSelection();
    renderNumberGrid();
    updateCheckout();
    setStatus("Reserva registrada. Agora envie o comprovante pelo WhatsApp.");
  } catch (error) {
    setStatus(error.message || "Não foi possível registrar a reserva. Tente novamente.");
  }
};

syncHeader();
loadSelection();
hydrateStaticText();
renderNumberGrid();
updateCheckout();
initFirebase();

window.addEventListener("scroll", syncHeader, { passive: true });

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
    setStatus("Pix copiado. Agora envie o comprovante para confirmar a reserva.");
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
  if (!selectedNumbers.size) {
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
