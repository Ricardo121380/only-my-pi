import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import "../index.css";
import "./native.css";
import NativeApp from "./App";

createRoot(document.getElementById("root")!).render(<TooltipProvider delayDuration={300}><NativeApp /></TooltipProvider>);
