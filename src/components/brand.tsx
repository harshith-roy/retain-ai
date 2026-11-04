import { Orbit } from "lucide-react";

export function Brand() {
  return <div className="flex items-center gap-2.5"><span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground"><Orbit className="size-5" strokeWidth={2.1} /></span><span className="text-xl font-bold">RETAIN<span className="text-muted-foreground">.AI</span></span></div>;
}