// WhatsApp Number Check Plugin
// Calls Baileys onWhatsApp() via the WhatsApp plugin's global connection controller registry.

const REGISTRY_KEY = Symbol.for("openclaw.whatsapp.connectionControllerRegistry");

function getWhatsAppSocket(accountId = "default") {
  const registry = globalThis[REGISTRY_KEY];
  if (!registry) return null;
  const controller = registry.controllers.get(accountId);
  if (!controller) return null;
  return typeof controller.getSocket === "function" ? controller.getSocket() : null;
}

function normalizePhone(raw) {
  return raw.trim().replace(/^\+/, "").replace(/[^\d]/g, "");
}

export default {
  id: "whatsapp-check",
  name: "WhatsApp Number Check",
  description: "Check if phone numbers are registered on WhatsApp via Baileys onWhatsApp()",

  register(api) {
    api.registerTool({
      name: "whatsapp_check",
      description:
        "Check if one or more phone numbers are registered on WhatsApp. " +
        "Returns { ok, results: [{ phone, exists, jid }] }. " +
        "Use before opening a coaching session to decide WhatsApp vs SMS.",
      parameters: {
        type: "object",
        required: ["phones"],
        properties: {
          phones: {
            type: "array",
            items: { type: "string" },
            description: 'Phone numbers in E.164 format, e.g. ["+16467718679"]',
          },
          accountId: {
            type: "string",
            description: "WhatsApp account ID (default: 'default')",
          },
        },
      },
      execute: async (_toolCallId, rawArgs) => {
        const params = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;
        const accountId = (params.accountId || "").trim() || "default";
        const sock = getWhatsAppSocket(accountId);

        if (!sock) {
          return {
            ok: false,
            error: `No WhatsApp connection for account '${accountId}'. Is WhatsApp connected?`,
          };
        }

        if (typeof sock.onWhatsApp !== "function") {
          return {
            ok: false,
            error: "WhatsApp socket does not expose onWhatsApp — Baileys version mismatch?",
          };
        }

        const normalized = params.phones.map(normalizePhone).filter(Boolean);
        if (!normalized.length) {
          return { ok: false, error: "No valid phone numbers provided." };
        }

        try {
          let waResults;
          try {
            waResults = await sock.onWhatsApp(...normalized);
          } catch (innerErr) {
            return { ok: false, error: `onWhatsApp query failed: ${innerErr}` };
          }
          if (!waResults || !Array.isArray(waResults)) {
            // Baileys returns undefined when USyncQuery gets no response
            // Treat as "can't determine" rather than crash
            const results = params.phones.map((phone) => ({
              phone,
              exists: false,
              jid: null,
              note: "query returned no data (WhatsApp may still be syncing)",
            }));
            return { ok: true, results, partial: true };
          }

          const results = params.phones.map((phone) => {
            const num = normalizePhone(phone);
            // Baileys returns { jid, exists: <contact-protocol-result> }
            // exists is truthy when the number is registered
            const match = waResults.find(
              (r) => r.jid && r.jid.replace(/@.*/, "") === num
            );
            return {
              phone,
              exists: match ? !!match.exists : false,
              jid: match ? match.jid : null,
            };
          });

          return { ok: true, results };
        } catch (err) {
          return { ok: false, error: `onWhatsApp call failed: ${err}` };
        }
      },
    });
  },
};
