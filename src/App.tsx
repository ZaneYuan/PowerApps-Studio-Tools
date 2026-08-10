import Layout from "./layout/Layout";
import { ActiveConnectionProvider } from "./native/activeConnection";
import { TabManagerProvider } from "./native/tabs";

export default function App() {
  return (
    <ActiveConnectionProvider>
      <TabManagerProvider>
        <Layout />
      </TabManagerProvider>
    </ActiveConnectionProvider>
  );
}
