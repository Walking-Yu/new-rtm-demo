import { Navigate, Route, Routes } from 'react-router-dom';
import { RoomPage } from './RoomPage';
import { SetupPage } from './SetupPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<SetupPage />} />
      <Route path="/room/:roomId" element={<RoomPage />} />
      <Route path="*" element={<Navigate to="/?reason=unknown-route" replace />} />
    </Routes>
  );
}
