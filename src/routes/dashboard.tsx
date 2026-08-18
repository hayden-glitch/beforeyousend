import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Your Command Center — Before You Send" },
      { name: "description", content: "Your Before You Send dashboard." },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/home" });
  },
});
