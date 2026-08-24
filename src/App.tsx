import Layout from "./layout/Layout";
import { ActiveConnectionProvider } from "./native/activeConnection";
import { TabManagerProvider } from "./native/tabs";
import ErrorBoundary from "./shared/ErrorBoundary";
import { ConfirmDialogProvider } from "./shared/ConfirmDialog";

export default function App() {
  return (
    <ErrorBoundary label="Power Apps Studio & Tools">
      <ConfirmDialogProvider>
        <ActiveConnectionProvider>
          <TabManagerProvider>
            <Layout />
          </TabManagerProvider>
        </ActiveConnectionProvider>
      </ConfirmDialogProvider>
    </ErrorBoundary>
  );
}
