// MailboxHub Durable Object: one per account. Browsers keep a hibernating WebSocket open; the Worker posts
// small change notifications (never message content) that are fanned out to every connected device.
export class MailboxHub {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        // Answer keep-alive pings without waking the object.
        state.setWebSocketAutoResponse?.(new WebSocketRequestResponsePair("ping", "pong"));
    }

    async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/notify" && request.method === "POST") {
            const event = await request.text();
            if (event.length > 4096) return new Response(null, { status: 413 });
            for (const socket of this.state.getWebSockets()) {
                try { socket.send(event); } catch { /* closed */ }
            }
            return new Response(null, { status: 204 });
        }
        if (request.headers.get("Upgrade") !== "websocket") return new Response(null, { status: 426 });
        const pair = new WebSocketPair();
        this.state.acceptWebSocket(pair[1]);
        pair[1].send(JSON.stringify({ type: "hello", at: Date.now() }));
        return new Response(null, { status: 101, webSocket: pair[0] });
    }

    webSocketMessage(socket, message) {
        if (message === "ping") socket.send("pong");
    }

    webSocketClose(socket, code) {
        try { socket.close(code === 1005 ? 1000 : code, "closed"); } catch { /* already closed */ }
    }

    webSocketError(socket) {
        try { socket.close(1011, "error"); } catch { /* already closed */ }
    }
}
