"use client";

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

import type { AssemblyField } from "@/lib/schemas/project";

export const ASSEMBLY_FIELD_LABELS: Record<AssemblyField, string> = {
  motion: "Motion in",
  beat: "Beat",
  interaction: "Interaction",
  camera: "Camera",
  setting: "Setting",
  characters: "Characters",
  style: "Style",
};

function SortableItem({ id, label }: { id: AssemblyField; label: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.88 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="border-border bg-background flex items-center gap-2 rounded-md border px-2 py-1.5"
    >
      <button
        type="button"
        className="text-muted-foreground cursor-grab touch-none rounded p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden />
        <span className="sr-only">Drag to reorder</span>
      </button>
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function AssemblyOrderEditor({
  order,
  onOrderChange,
}: {
  order: AssemblyField[];
  onOrderChange: (next: AssemblyField[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.indexOf(active.id as AssemblyField);
    const newIndex = order.indexOf(over.id as AssemblyField);
    if (oldIndex === -1 || newIndex === -1) return;
    onOrderChange(arrayMove(order, oldIndex, newIndex));
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <ul className="space-y-1.5">
          {order.map((id) => (
            <li key={id}>
              <SortableItem id={id} label={ASSEMBLY_FIELD_LABELS[id]} />
            </li>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
