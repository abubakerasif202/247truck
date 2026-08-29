import Link from "next/link";
import { PHONE_HREF } from "./site-data";

export default function NotFound() {
  return <main className="page-masthead"><p className="eyebrow"><span />Page not found</p><h1>Wrong turn.</h1><p>The page you requested is not available. Return home or call the team for truck tyre assistance.</p><div className="hero-buttons"><Link className="button button--red" href="/">Return home</Link><a className="button button--ghost" href={PHONE_HREF}>Call now</a></div></main>;
}
