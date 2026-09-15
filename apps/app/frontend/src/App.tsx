import { Show, type Component } from "solid-js";
import Home from "./pages/Home";
import ArtifactPage from "./pages/Artifact";

const artifactMatch = location.pathname.match(/^\/artifact\/([\w-]+)$/);

// "/" is behind Cloudflare Access; a private /artifact/:id page bounces here
// with ?next=<path> to force login (see getArtifactJson's 401 handling in
// pages/Artifact.tsx), then we bounce back once Access lets the request
// through. Re-validate the shape here too since it round-trips via the
// browser URL bar - never follow an arbitrary next value.
const next = new URLSearchParams(location.search).get("next");
const redirecting = !!next && /^\/artifact\/[\w-]+$/.test(next);
if (redirecting) location.replace(next!);

const App: Component = () => {
  return (
    <Show when={!redirecting}>
      <Show when={artifactMatch} fallback={<Home />}>
        {(m) => <ArtifactPage id={m()[1]} />}
      </Show>
    </Show>
  );
};

export default App;
