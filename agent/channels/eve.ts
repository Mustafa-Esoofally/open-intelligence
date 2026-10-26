import { GET, type HttpRouteDefinition, type RouteDefinition } from "eve/channels";
import { type AuthFn, localDev, routeAuth } from "eve/channels/auth";
import { defaultEveAuth, eveChannel } from "eve/channels/eve";

import { devUsers } from "../lib/dev-users";
import { type Caller, callerOf } from "../lib/policy";
import { isMember, membersOf, recordSession, sessionsOf } from "../lib/sessions";

// Ordered auth walk. `devUsers()` answers every request during `eve dev`;
// `localDev()` only matters for `vercel dev`. Neither accepts production
// traffic, so a deployment fails closed until a real authenticator (OIDC/SSO
// mapped to { orgId, teamIds, role }) is put in front of them.
const auth: readonly AuthFn<Request>[] = [devUsers(), localDev()];

const channel = eveChannel({
  auth,
  // Sessions are multiplayer: tell the model who sent each message and who else is in the chat.
  async onMessage(ctx) {
    const caller = callerOf(ctx.eve.caller);
    if (caller === null) return { auth: defaultEveAuth(ctx) };
    const others =
      ctx.eve.sessionId === undefined
        ? []
        : (await membersOf(ctx.eve.sessionId)).filter((m) => m.userId !== caller.userId).map((m) => m.userId);
    const team = caller.teamIds[0] === undefined ? "" : `, team ${caller.teamIds[0]}`;
    return {
      auth: defaultEveAuth(ctx),
      context: [
        `This message is from ${caller.userId} (${caller.role}${team}).` +
          (others.length > 0 ? ` Also in this chat: ${others.join(", ")}.` : ""),
      ],
    };
  },
});

// eve authenticates every route but lets any signed-in caller use any session id.
// Wrap the session routes so only the chat's members get in (404 otherwise, so
// ids don't leak), record the creator on create, and add a "my chats" listing.
const SESSION_PARAM = /:(sessionId|parentSessionId)\b/;

export default { ...channel, routes: [...channel.routes.map(guard), listSessions()] };

function guard<T>(route: RouteDefinition<T>): RouteDefinition<T> {
  if (route.transport !== "http") return route;
  if (route.method === "POST" && route.path === "/eve/v1/session") return onCreate(route);
  const param = SESSION_PARAM.exec(route.path)?.[1];
  if (param === undefined) return route;
  return {
    ...route,
    async handler(request, args) {
      const caller = await callerFor(request);
      if (caller instanceof Response) return caller;
      const sessionId = args.params[param];
      if (sessionId === undefined || !(await isMember(sessionId, caller))) {
        return Response.json({ ok: false, error: "Session not found." }, { status: 404 });
      }
      return route.handler(request, args);
    },
  };
}

function onCreate<T>(route: HttpRouteDefinition<T>): HttpRouteDefinition<T> {
  return {
    ...route,
    async handler(request, args) {
      const caller = await callerFor(request);
      if (caller instanceof Response) return caller;
      const response = await route.handler(request, args);
      const sessionId = response.headers.get("x-eve-session-id");
      if (response.ok && sessionId) await recordSession(sessionId, caller);
      return response;
    },
  };
}

function listSessions(): HttpRouteDefinition {
  return GET("/glass/v1/sessions", async (request) => {
    const caller = await callerFor(request);
    if (caller instanceof Response) return caller;
    return Response.json({ ok: true, sessions: await sessionsOf(caller) });
  });
}

/** The org user behind a request, or the response to send instead (401 from the auth walk, 403 if not an org user). */
async function callerFor(request: Request): Promise<Caller | Response> {
  const result = await routeAuth(request, auth);
  if (result instanceof Response) return result;
  return callerOf(result) ?? Response.json({ ok: false, error: "Sessions need an org user." }, { status: 403 });
}
