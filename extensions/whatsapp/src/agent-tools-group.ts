// Whatsapp plugin module implements agent tools group management behavior.
import { readFile } from "node:fs/promises";
import { jsonResult } from "openclaw/plugin-sdk/channel-actions";
import type { ChannelAgentTool } from "openclaw/plugin-sdk/channel-contract";
import { Type } from "typebox";
import { getRegisteredWhatsAppConnectionController } from "./connection-controller-registry.js";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function resolveAccountId(raw: unknown): string {
  return readOptionalString(raw) ?? DEFAULT_ACCOUNT_ID;
}

async function fetchImageBuffer(pictureUrl: string): Promise<Buffer> {
  if (pictureUrl.startsWith("file://")) {
    const filePath = pictureUrl.slice("file://".length);
    return readFile(filePath);
  }
  if (pictureUrl.startsWith("/") || pictureUrl.startsWith("./") || pictureUrl.startsWith("../")) {
    return readFile(pictureUrl);
  }
  // HTTP/HTTPS URL
  const response = await fetch(pictureUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch picture: HTTP ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function normalizeParticipants(rawParticipants: unknown[]): string[] {
  return rawParticipants.map((p: unknown) => {
    const s = String(p).trim().replace(/^\+/, "");
    return s.includes("@") ? s : `${s}@s.whatsapp.net`;
  });
}

export function createWhatsAppGroupTool(): ChannelAgentTool {
  return {
    label: "WhatsApp Group",
    name: "whatsapp_group",
    description:
      "Create or manage WhatsApp groups. Actions: " +
      "create (new group with participants and optional picture), " +
      "update (change name, description, picture, announcement mode, or manage participants via participantAction=add/remove/promote), " +
      "info (get group metadata and participants), " +
      "leave (leave a group), " +
      "send (send a text message to a group).",
    parameters: Type.Object({
      action: Type.Unsafe<"create" | "update" | "info" | "leave" | "send">({
        type: "string",
        enum: ["create", "update", "info", "leave", "send"],
        description: "The group management action to perform",
      }),
      accountId: Type.Optional(Type.String({ description: "WhatsApp account ID (default: 'default')" })),
      name: Type.Optional(Type.String({ description: "Group name (required for create, optional for update)" })),
      participants: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "E.164 phone numbers. Required for create and for update with participantAction.",
        }),
      ),
      groupJid: Type.Optional(
        Type.String({ description: "Group JID (required for update/info/leave/send)" }),
      ),
      description: Type.Optional(Type.String({ description: "Group description (for update)" })),
      pictureUrl: Type.Optional(
        Type.String({
          description: "URL or local path to group picture image (JPEG/PNG)",
        }),
      ),
      announcement: Type.Optional(
        Type.Boolean({
          description: "If true, only admins can send messages",
        }),
      ),
      text: Type.Optional(
        Type.String({ description: "Message text (required for send action)" }),
      ),
      participantAction: Type.Optional(
        Type.Unsafe<"add" | "remove" | "promote">({
          type: "string",
          enum: ["add", "remove", "promote"],
          description:
            "Participant management sub-action (use with action=update and participants array). " +
            "add = add members, remove = remove members, promote = make admin.",
        }),
      ),
    }),
    execute: async (_toolCallId, args) => {
      const a = args as Record<string, unknown>;
      const action = String(a.action ?? "");
      const accountId = resolveAccountId(a.accountId);

      const controller = getRegisteredWhatsAppConnectionController(accountId);
      if (!controller) {
        return jsonResult({
          ok: false,
          error: `No WhatsApp connection found for account '${accountId}'. Is the channel connected?`,
        });
      }

      const sock = controller.getSocket();
      if (!sock) {
        return jsonResult({
          ok: false,
          error: `WhatsApp socket is not open for account '${accountId}'. The connection may be starting up or disconnected.`,
        });
      }

      try {
        // -- CREATE --------------------------------------------------------
        if (action === "create") {
          const name = readOptionalString(a.name);
          if (!name) {
            return jsonResult({ ok: false, error: "Missing required parameter: name" });
          }
          const rawParticipants = Array.isArray(a.participants) ? a.participants : [];
          if (rawParticipants.length === 0) {
            return jsonResult({
              ok: false,
              error: "Missing required parameter: participants (must be a non-empty array)",
            });
          }
          const participants = normalizeParticipants(rawParticipants);
          const meta = await sock.groupCreate(name, participants);
          const groupJid = meta.id;

          if (a.pictureUrl) {
            try {
              const buf = await fetchImageBuffer(String(a.pictureUrl));
              await sock.updateProfilePicture(groupJid, buf);
            } catch (picErr) {
              return jsonResult({
                ok: true,
                groupJid,
                name: meta.subject,
                warning: `Group created but picture update failed: ${String(picErr)}`,
              });
            }
          }

          if (typeof a.announcement === "boolean") {
            await sock.groupSettingUpdate(groupJid, a.announcement ? "announcement" : "not_announcement");
          }

          return jsonResult({ ok: true, groupJid, name: meta.subject });
        }

        // -- UPDATE --------------------------------------------------------
        if (action === "update") {
          const groupJid = readOptionalString(a.groupJid);
          if (!groupJid) {
            return jsonResult({ ok: false, error: "Missing required parameter: groupJid" });
          }

          // Handle participant management sub-action
          const participantAction = readOptionalString(a.participantAction);
          if (participantAction) {
            const validActions = ["add", "remove", "promote"];
            if (!validActions.includes(participantAction)) {
              return jsonResult({
                ok: false,
                error: `Invalid participantAction '${participantAction}'. Valid: add, remove, promote`,
              });
            }
            const rawParticipants = Array.isArray(a.participants) ? a.participants : [];
            if (rawParticipants.length === 0) {
              return jsonResult({
                ok: false,
                error: "Missing required parameter: participants (needed for participantAction)",
              });
            }
            const participants = normalizeParticipants(rawParticipants);
            const result = await sock.groupParticipantsUpdate(
              groupJid,
              participants,
              participantAction as "add" | "remove" | "promote",
            );
            return jsonResult({
              ok: true,
              groupJid,
              participantAction,
              result,
            });
          }

          // Standard metadata updates
          const updates: string[] = [];
          const errors: string[] = [];

          if (readOptionalString(a.name)) {
            await sock.groupUpdateSubject(groupJid, String(a.name));
            updates.push("name");
          }

          if (typeof a.description === "string") {
            await sock.groupUpdateDescription(groupJid, a.description || undefined);
            updates.push("description");
          }

          if (typeof a.announcement === "boolean") {
            await sock.groupSettingUpdate(groupJid, a.announcement ? "announcement" : "not_announcement");
            updates.push("announcement");
          }

          if (a.pictureUrl) {
            try {
              const buf = await fetchImageBuffer(String(a.pictureUrl));
              await sock.updateProfilePicture(groupJid, buf);
              updates.push("pictureUrl");
            } catch (picErr) {
              errors.push(`pictureUrl: ${String(picErr)}`);
            }
          }

          return jsonResult({ ok: errors.length === 0, updated: updates, errors });
        }

        // -- INFO ----------------------------------------------------------
        if (action === "info") {
          const groupJid = readOptionalString(a.groupJid);
          if (!groupJid) {
            return jsonResult({ ok: false, error: "Missing required parameter: groupJid" });
          }

          const meta = await sock.groupMetadata(groupJid);
          return jsonResult({
            groupJid: meta.id,
            name: meta.subject,
            description: meta.desc ?? null,
            announce: meta.announce ?? false,
            creation: meta.creation ?? null,
            owner: meta.owner ?? null,
            participants: meta.participants.map((p) => ({
              jid: p.id,
              isAdmin: p.isAdmin ?? false,
              isSuperAdmin: p.isSuperAdmin ?? false,
            })),
          });
        }

        // -- LEAVE ---------------------------------------------------------
        if (action === "leave") {
          const groupJid = readOptionalString(a.groupJid);
          if (!groupJid) {
            return jsonResult({ ok: false, error: "Missing required parameter: groupJid" });
          }
          await sock.groupLeave(groupJid);
          return jsonResult({ ok: true, groupJid });
        }

        // -- SEND ----------------------------------------------------------
        if (action === "send") {
          const groupJid = readOptionalString(a.groupJid);
          if (!groupJid) {
            return jsonResult({ ok: false, error: "Missing required parameter: groupJid" });
          }
          const text = readOptionalString(a.text);
          if (!text) {
            return jsonResult({ ok: false, error: "Missing required parameter: text" });
          }
          const sent = await sock.sendMessage(groupJid, { text });
          return jsonResult({
            ok: true,
            groupJid,
            messageId: sent?.key?.id ?? null,
          });
        }

        return jsonResult({
          ok: false,
          error: `Unknown action '${action}'. Valid actions: create, update, info, leave, send`,
        });
      } catch (err) {
        return jsonResult({
          ok: false,
          error: `WhatsApp group operation failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },
  };
}
