import type { Component } from "solid-js";

const Spinner: Component<{ label?: string }> = (props) => (
  <div class="spinner-row">
    <span class="spinner" aria-hidden="true" />
    {props.label}
  </div>
);

export default Spinner;
