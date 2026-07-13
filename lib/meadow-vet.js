const fs = require("fs");
const path = require("path");

const SAMPLE_DATA_PATH = path.join(__dirname, "..", "data", "services.json");

function getConfig() {
  return {
    serviceDataUrl: process.env.SERVICE_DATA_URL || "",
    sheetCsvUrl: process.env.GOOGLE_SHEET_CSV_URL || "",
    openAiApiKey: process.env.OPENAI_API_KEY || "",
    openAiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
    openAiBaseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  };
}

async function loadServices() {
  const { serviceDataUrl, sheetCsvUrl } = getConfig();

  if (serviceDataUrl) {
    const response = await fetch(serviceDataUrl, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`Service data request failed with status ${response.status}`);
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();

    if (serviceDataUrl.toLowerCase().endsWith(".json") || contentType.includes("application/json")) {
      const data = await response.json();
      return Array.isArray(data) ? data.map(normalizeServiceRow) : [];
    }

    const csv = await response.text();
    return parseCsv(csv).map(normalizeServiceRow);
  }

  if (sheetCsvUrl) {
    const response = await fetch(toGoogleSheetCsvUrl(sheetCsvUrl), { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`Sheet request failed with status ${response.status}`);
    }

    const csv = await response.text();
    const rows = parseCsv(csv);

    if (!rows.length) {
      throw new Error("Sheet returned no rows.");
    }

    return rows.map(normalizeServiceRow);
  }

  return JSON.parse(fs.readFileSync(SAMPLE_DATA_PATH, "utf8"));
}

function getServiceSourceLabel() {
  const { serviceDataUrl, sheetCsvUrl } = getConfig();

  if (serviceDataUrl) {
    return "hosted-data-url";
  }

  if (sheetCsvUrl) {
    return "google-sheet";
  }

  return "sample-data";
}

function normalizeServiceRow(row) {
  const normalized = {};

  for (const [key, value] of Object.entries(row)) {
    const cleanKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    normalized[cleanKey] = String(value || "").trim();
  }

  return {
    serviceId: normalized.serviceid || normalized.id || "",
    category: normalized.category || "",
    species: normalized.species || "",
    price: normalized.price || normalized.pricingperservice || "",
    duration: normalized.duration || normalized.howlongitlasts || "",
    appointmentRequired: normalized.appointmentrequired || normalized.requiresanappointment || "",
    availability: normalized.availability || normalized.howmanyslotstheyhaveleft || "",
    specialOffer: normalized.specialoffer || normalized.arethereanyspecialoffersonthat || "",
    serviceName: normalized.servicename || normalized.name || "",
    description: normalized.description || "",
  };
}

async function answerWithLlm(message, services) {
  const { openAiApiKey, openAiBaseUrl, openAiModel } = getConfig();

  const response = await fetch(`${openAiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiApiKey}`,
    },
    body: JSON.stringify({
      model: openAiModel,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: [
            "You are the Meadow Vet Care assistant.",
            "Answer only questions related to the vet clinic and its services.",
            "Use the provided service data as the source of truth.",
            "Keep answers short, clear, and customer-facing.",
            "If the question is unrelated to the clinic, politely refuse and say you can only help with Meadow Vet Care services.",
            `Service data: ${JSON.stringify(services)}`,
          ].join(" "),
        },
        { role: "user", content: message },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM request failed with status ${response.status}: ${errorText}`);
  }

  const payload = await response.json();
  return payload.choices?.[0]?.message?.content?.trim() || "I could not generate a reply just now.";
}

function answerWithoutLlm(message, services) {
  const query = message.toLowerCase();
  const matched = services.filter((service) => {
    return [service.serviceId, service.category, service.species, service.serviceName, service.description]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });

  if (query.includes("microchip")) {
    const microchip = services.find((service) => service.serviceName.toLowerCase().includes("microchip"));
    if (microchip) {
      return `${microchip.serviceName} costs EUR ${microchip.price}, lasts ${microchip.duration}, and availability is ${microchip.availability}.`;
    }
  }

  if (query.includes("dog services")) {
    const dogServices = services.filter((service) => service.species.toLowerCase().includes("dog"));
    if (dogServices.length) {
      return `Dog services include: ${dogServices.map((service) => `${service.serviceName} (EUR ${service.price})`).join(", ")}.`;
    }
  }

  if (query.includes("telehealth")) {
    const telehealth = services.find((service) => service.category.toLowerCase().includes("telehealth") || service.serviceName.toLowerCase().includes("telehealth"));
    if (telehealth) {
      return `Yes. ${telehealth.serviceName} is available for EUR ${telehealth.price} and ${telehealth.availability}.`;
    }
  }

  if (query.includes("most expensive")) {
    const sorted = [...services].sort((a, b) => Number(b.price) - Number(a.price));
    const top = sorted[0];
    if (top) {
      return `The most expensive listed service is ${top.serviceName} at EUR ${top.price}.`;
    }
  }

  if (matched.length) {
    const service = matched[0];
    return `${service.serviceName} costs EUR ${service.price}, lasts ${service.duration}, and ${service.description}`;
  }

  return "I can help with Meadow Vet Care services, pricing, availability, and appointment questions.";
}

function toGoogleSheetCsvUrl(input) {
  const value = String(input || "").trim();

  if (!value) {
    return value;
  }

  if (value.includes("output=csv") || value.endsWith(".csv")) {
    return value;
  }

  const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) {
    return value;
  }

  const sheetId = match[1];
  const gidMatch = value.match(/[?&]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : "0";

  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}

function parseCsv(input) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }

      row.push(current);
      if (row.some((cell) => cell !== "")) {
        rows.push(row);
      }
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  if (current || row.length) {
    row.push(current);
    rows.push(row);
  }

  const [headers, ...dataRows] = rows;
  if (!headers) {
    return [];
  }

  return dataRows.map((dataRow) => {
    const record = {};
    headers.forEach((header, index) => {
      record[String(header || "").trim()] = String(dataRow[index] || "").trim();
    });
    return record;
  });
}

module.exports = {
  answerWithLlm,
  answerWithoutLlm,
  getServiceSourceLabel,
  getConfig,
  loadServices,
};
