const messagesEl = document.getElementById("messages");
const serviceCardsEl = document.getElementById("serviceCards");
const chatForm = document.getElementById("chatForm");
const messageInput = document.getElementById("messageInput");
const dataSourcePill = document.getElementById("dataSourcePill");

addMessage("assistant", "Hello and welcome to Meadow Vet Care. Ask me about our services, pricing, offers, or appointment availability.");

loadServices();

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = messageInput.value.trim();

  if (!message) {
    return;
  }

  addMessage("user", message);
  messageInput.value = "";

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message }),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Could not get a reply.");
    }

    addMessage("assistant", payload.reply);
  } catch (error) {
    addMessage("assistant", `Sorry, something went wrong: ${error.message}`);
  }
});

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    messageInput.value = button.dataset.prompt;
    chatForm.requestSubmit();
  });
});

async function loadServices() {
  try {
    const response = await fetch("/api/services");
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Could not load services.");
    }

    dataSourcePill.textContent = payload.source === "google-sheet"
      ? "Live Google Sheet connected"
      : payload.source === "hosted-data-url"
        ? "Live hosted data connected"
        : "Using sample service data";
    renderServices(payload.services || []);
  } catch (error) {
    dataSourcePill.textContent = "Service feed unavailable";
    serviceCardsEl.innerHTML = `<p class="emptyState">${error.message}</p>`;
  }
}

function renderServices(services) {
  if (!services.length) {
    serviceCardsEl.innerHTML = '<p class="emptyState">No services available.</p>';
    return;
  }

  serviceCardsEl.innerHTML = services
    .map((service) => {
      return `
        <article class="serviceCard">
          <h3>${service.serviceName}</h3>
          <p>${service.description}</p>
          <p class="serviceMeta">${service.species} | ${service.category} | EUR ${service.price}</p>
          <p class="serviceMeta">${service.duration} | ${service.availability}</p>
        </article>
      `;
    })
    .join("");
}

function addMessage(role, text) {
  const element = document.createElement("div");
  element.className = `message ${role}`;
  element.textContent = text;
  messagesEl.appendChild(element);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
