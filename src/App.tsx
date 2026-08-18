import Layout from "./layout/Layout";
import { ActiveConnectionProvider } from "./native/activeConnection";
import { TabManagerProvider } from "./native/tabs";
import ErrorBoundary from "./shared/ErrorBoundary";

export default function App() {
  return (
    <ErrorBoundary label="Power Apps Studio & Tools">
      <ActiveConnectionProvider>
        <TabManagerProvider>
          <Layout />
        </TabManagerProvider>
      </ActiveConnectionProvider>
    </ErrorBoundary>
  );
}
