import ReactDOM from "react-dom";
import { HomePage } from "./site-components";

export default function Home() {
  // Preload the workshop hero photograph used by the above-the-fold design.
  ReactDOM.preload("/images/pack-03-workshop-truck.webp", {
    as: "image",
    type: "image/webp",
    fetchPriority: "high",
  });
  return <HomePage />;
}
