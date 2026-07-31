import {
  LIMITS,
  SOCKET_CHANNEL,
  localize,
  reportError
} from "./constants.mjs";
import { ACTIONS, ACTION_ALLOWLIST } from "./services/action-service.mjs";
import { hasResponsibleGM, isResponsibleGM } from "./store/research-store.mjs";
import { asString, createStableId } from "./utils/validation.mjs";

export class SocketController {
  #pending = new Map();
  #processed = new Set();
  #bound = false;

  constructor(actionService, store) {
    this.actionService = actionService;
    this.store = store;
  }

  bind() {
    if (this.#bound) return;
    this.#bound = true;
    game.socket.on(SOCKET_CHANNEL, (packet, senderUserId) => {
      void this.#onPacket(packet, senderUserId);
    });
  }

  async execute(action, payload = {}) {
    if (!ACTION_ALLOWLIST.has(action)) throw new Error(localize("Errors.UnsupportedAction", { action }));
    const requestId = createStableId("request");
    if (game.user?.isGM && isResponsibleGM()) {
      return this.actionService.handle(action, payload, game.user.id, { requestId, fromSocket: false });
    }
    if (!hasResponsibleGM()) {
      ui.notifications?.warn?.(localize("Errors.NoActiveGM"));
      return false;
    }

    const packet = {
      type: "request",
      action,
      requestId,
      userId: game.user.id,
      payload: { ...payload }
    };
    if (action === ACTIONS.ROLL_ENGINEER) {
      Object.assign(packet, {
        projectId: asString(payload.projectId),
        engineerSlot: Number(payload.engineerSlot),
        actorUuid: asString(payload.actorUuid),
        currentWeek: Number(payload.currentWeek)
      });
    }

    const result = this.#waitForResponse(requestId, game.users?.activeGM?.id ?? "");
    this.#emitToActiveGM(packet);
    return result;
  }

  sendRollRequest(payload) {
    return this.execute(ACTIONS.ROLL_ENGINEER, payload);
  }

  async #onPacket(packet, senderUserId) {
    if (!packet || typeof packet !== "object") return;
    if (!senderUserId) {
      console.warn(`${SOCKET_CHANNEL} | Rejected packet without server-authenticated sender identity.`);
      return;
    }

    if (packet.type === "response") {
      this.#handleResponse(packet, senderUserId);
      return;
    }
    if (packet.type !== "request" || !isResponsibleGM()) return;
    if (packet.userId !== senderUserId) {
      this.#respond(senderUserId, packet.requestId, false, undefined, localize("Errors.SocketIdentity"));
      return;
    }

    const requestId = asString(packet.requestId);
    const sender = game.users?.get?.(senderUserId);
    if (!requestId || requestId.length > 128 || !sender?.active || !ACTION_ALLOWLIST.has(packet.action)) {
      this.#respond(senderUserId, requestId, false, undefined, localize("Errors.InvalidSocketRequest"));
      return;
    }
    if (this.#processed.has(requestId) || this.store.state.processedRequestIds.includes(requestId)) {
      this.#respond(senderUserId, requestId, false, undefined, localize("Errors.DuplicateRequest"));
      return;
    }
    this.#rememberInMemory(requestId);

    try {
      const payload = this.#verifiedPayload(packet);
      const result = await this.actionService.handle(packet.action, payload, senderUserId, { requestId, fromSocket: true });
      await this.#rememberPersistent(requestId);
      this.#respond(senderUserId, requestId, true, serializableResult(result));
    } catch (error) {
      console.warn(`${SOCKET_CHANNEL} | Rejected action ${packet.action}`, error);
      this.#respond(senderUserId, requestId, false, undefined, error?.message || localize("Errors.ActionRejected"));
    }
  }

  #verifiedPayload(packet) {
    if (packet.action !== ACTIONS.ROLL_ENGINEER) return packet.payload && typeof packet.payload === "object" ? packet.payload : {};
    return {
      projectId: asString(packet.projectId),
      engineerSlot: Number(packet.engineerSlot),
      actorUuid: asString(packet.actorUuid),
      currentWeek: Number(packet.currentWeek),
      manualResult: packet.payload?.manualResult
    };
  }

  #handleResponse(packet, senderUserId) {
    if (packet.recipientUserId !== game.user?.id) return;
    const pending = this.#pending.get(packet.requestId);
    if (!pending) return;
    const sender = game.users?.get?.(senderUserId);
    if ((pending.expectedSenderId && senderUserId !== pending.expectedSenderId) || !sender?.isGM) return;
    this.#pending.delete(packet.requestId);
    clearTimeout(pending.timeout);
    if (packet.ok) pending.resolve(packet.result);
    else pending.reject(new Error(packet.error || localize("Errors.ActionRejected")));
  }

  #waitForResponse(requestId, expectedSenderId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error(localize("Errors.SocketTimeout")));
      }, LIMITS.SOCKET_TIMEOUT_MS);
      this.#pending.set(requestId, { resolve, reject, timeout, expectedSenderId });
    });
  }

  #emitToActiveGM(packet) {
    const activeGM = game.users?.activeGM;
    const options = activeGM ? { recipients: [activeGM.id] } : undefined;
    game.socket.emit(SOCKET_CHANNEL, packet, options);
  }

  #respond(recipientUserId, requestId, ok, result, error = "") {
    if (!requestId) return;
    game.socket.emit(SOCKET_CHANNEL, {
      type: "response",
      recipientUserId,
      requestId,
      ok,
      result,
      error
    }, { recipients: [recipientUserId] });
  }

  #rememberInMemory(requestId) {
    this.#processed.add(requestId);
    while (this.#processed.size > LIMITS.MAX_PROCESSED_REQUEST_IDS) {
      this.#processed.delete(this.#processed.values().next().value);
    }
  }

  async #rememberPersistent(requestId) {
    if (this.store.state.processedRequestIds.includes(requestId)) return;
    try {
      await this.store.transaction("socketRequestDedupe", envelope => {
        if (!envelope.researchState.processedRequestIds.includes(requestId)) {
          envelope.researchState.processedRequestIds.push(requestId);
          envelope.researchState.processedRequestIds = envelope.researchState.processedRequestIds.slice(-LIMITS.MAX_PROCESSED_REQUEST_IDS);
        }
      }, { silent: true });
    } catch (error) {
      reportError("socketDedupe", error, { notify: false });
    }
  }
}

function serializableResult(result) {
  if (result === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(result));
  } catch (_error) {
    return null;
  }
}
