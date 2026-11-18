import { Navigate, Route, Routes } from "react-router-dom";
import Chat from "./pages/Chat";
import InstanceDashboard from "./pages/InstanceDashboard";
import InstanceSettings from "./pages/InstanceSettings";
import Landing from "./pages/Landing";
import Setup from "./pages/Setup";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/comecar" element={<Setup />} />
      <Route path="/i/:id" element={<InstanceDashboard />} />
      <Route path="/i/:id/chat" element={<Chat />} />
      <Route path="/i/:id/config" element={<InstanceSettings />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
