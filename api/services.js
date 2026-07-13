const { getServiceSourceLabel, loadServices } = require("../lib/meadow-vet");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const services = await loadServices();
    res.status(200).json({ services, source: getServiceSourceLabel() });
  } catch (error) {
    res.status(500).json({ error: "Could not load services.", detail: error.message });
  }
};
