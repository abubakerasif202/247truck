import ReactDOM from "react-dom";
import { HomePage } from "./site-components";

export default function Home() {
  // Preload the matching hero asset for each viewport so mobile avoids the
  // larger desktop photograph.
  ReactDOM.preload("/images/247truck-ai-workshop-hero.webp", {
    as: "image",
    type: "image/webp",
    fetchPriority: "high",
    media: "(min-width: 701px)",
  });
  ReactDOM.preload("/images/247truck-ai-workshop-mobile.webp", {
    as: "image",
    type: "image/webp",
    fetchPriority: "high",
    media: "(max-width: 700px)",
  });
  return <HomePage />;
}
