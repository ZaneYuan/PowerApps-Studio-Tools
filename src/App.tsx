import { BrowserRouter, Route, Routes } from "react-router";
import Layout from "./layout/Layout";
import Home from "./pages/Home";
import ToolPage from "./pages/ToolPage";
import NotFound from "./pages/NotFound";
import { ActiveConnectionProvider } from "./native/activeConnection";

export default function App() {
  return (
    <ActiveConnectionProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="tools/:toolId" element={<ToolPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ActiveConnectionProvider>
  );
}
