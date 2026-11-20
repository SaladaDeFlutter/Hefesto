import { Navigate, Route, Routes, useParams } from "react-router-dom";
import Chat from "./pages/Chat";
import ConnectorDetail from "./pages/ConnectorDetail";
import Connectors from "./pages/Connectors";
import InstanceDashboard from "./pages/InstanceDashboard";
import InstanceSettings from "./pages/InstanceSettings";
import Landing from "./pages/Landing";
import Setup from "./pages/Setup";

function ChatRedirect() {
  const { id = "" } = useParams();
  return <Navigate to={`/i/${id}/chat`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/sobre" element={<Navigate to="/" replace />} />
      <Route path="/comecar" element={<Setup />} />
      <Route path="/i/:id" element={<ChatRedirect />} />
      <Route path="/i/:id/painel" element={<InstanceDashboard />} />
      <Route path="/i/:id/chat" element={<Chat />} />
      <Route path="/i/:id/conectores" element={<Connectors />} />
      <Route path="/i/:id/conectores/:alias" element={<ConnectorDetail />} />
      <Route path="/i/:id/config" element={<InstanceSettings />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
