Deno.serve((request: Request) => {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const outcome = new URL(request.url).searchParams.get("billing");
  const message = outcome === "success"
    ? "Workpad Pro is being activated.\n\nYour payment was received. Return to Workpad and reopen Settings; activation normally appears within a few seconds.\n\nYou can close this tab."
    : outcome === "cancelled"
      ? "Workpad checkout cancelled.\n\nNothing was charged. You can close this tab and return to Workpad whenever you are ready."
      : "Workpad billing updated.\n\nYour changes have been saved. Return to Workpad and reopen Settings to refresh your plan.\n\nYou can close this tab.";
  return new Response(message, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer"
    }
  });
});
