import type { CanvasKind } from '../domain/scenario';
import { CallCanvas } from './canvases/CallCanvas';
import { ChatCanvas } from './canvases/ChatCanvas';
import { ClassroomCanvas } from './canvases/ClassroomCanvas';
import { DeviceCanvas } from './canvases/DeviceCanvas';
import { MeetingCanvas } from './canvases/MeetingCanvas';
import { OperationsCanvas } from './canvases/OperationsCanvas';
import { OrderCanvas } from './canvases/OrderCanvas';
import { RoomCanvas } from './canvases/RoomCanvas';
import type { CanvasProps } from './canvases/types';

const canvases: Record<CanvasKind, (props: CanvasProps) => React.JSX.Element> = {
  room: RoomCanvas,
  classroom: ClassroomCanvas,
  device: DeviceCanvas,
  meeting: MeetingCanvas,
  order: OrderCanvas,
  call: CallCanvas,
  chat: ChatCanvas,
  operations: OperationsCanvas,
};

export function ScenarioCanvas(props: CanvasProps) {
  const Canvas = canvases[props.scenario.canvas];
  return <Canvas {...props} />;
}
