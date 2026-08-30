import { Show, type Component } from "solid-js";
import Home from "./pages/Home";
import ArtifactPage from "./pages/Artifact";

const artifactMatch = location.pathname.match(/^\/artifact\/([\w-]+)$/);

const App: Component = () => {
  return (
    <Show when={artifactMatch} fallback={<Home />}>
      {(m) => <ArtifactPage id={m()[1]} />}
    </Show>
  );
};

export default App;
