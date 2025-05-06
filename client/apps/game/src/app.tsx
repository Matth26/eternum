import "./index.css";
import { DevToolsPanel } from "./ui/components/DevTools/DevToolsPanel";
import { Toaster } from "./ui/components/toaster";
import { TransactionNotification } from "./ui/components/tx-emit";
import { WorldLoading } from "./ui/components/world-loading";
import { World } from "./ui/layouts/world";

function App({ backgroundImage }: { backgroundImage: string }) {
  return (
    <>
      <Toaster />
      <TransactionNotification />
      <World backgroundImage={backgroundImage} />
      <WorldLoading />
      <DevToolsPanel />
    </>
  );
}

export default App;
