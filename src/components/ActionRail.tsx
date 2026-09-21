import type { Handedness, MarkStyle, SelectionPayload } from "../lib/types";

const COLORS = ["#e8c56b", "#8fbf6a", "#e8a0b3", "#7eb6d9"];

const ACTIONS: Array<{
  id: string;
  label: string;
  key: string;
  run: "highlight" | "underline" | "strike" | "note" | "translate" | "explain";
  style?: MarkStyle;
}> = [
  { id: "highlight", label: "高亮", key: "H", run: "highlight", style: "highlight" },
  { id: "underline", label: "下划线", key: "U", run: "underline", style: "underline" },
  { id: "strike", label: "删除线", key: "S", run: "strike", style: "strike" },
  { id: "note", label: "备注", key: "N", run: "note" },
  { id: "translate", label: "翻译", key: "T", run: "translate" },
  { id: "explain", label: "解释", key: "E", run: "explain" },
];

type Props = {
  selection: SelectionPayload;
  handedness: Handedness;
  stageLeft: number;
  stageTop: number;
  stageWidth: number;
  stageHeight: number;
  onMark: (style: MarkStyle, color?: string) => void;
  onNote: () => void;
  onTranslate: () => void;
  onExplain: () => void;
};

export default function ActionRail({
  selection,
  handedness,
  stageLeft,
  stageTop,
  stageWidth,
  stageHeight,
  onMark,
  onNote,
  onTranslate,
  onExplain,
}: Props) {
  const first = selection.rects[0];
  const last = selection.rects.at(-1) ?? first;
  const railW = 156;
  const rightX = stageLeft + (last ? (last.x + last.w) * stageWidth : selection.x) + 12;
  const leftX = stageLeft + (first ? first.x * stageWidth : 24) - railW - 12;
  const rawX = handedness === "right" ? rightX : leftX;
  const left = Math.max(8, Math.min(rawX, stageLeft + stageWidth - railW));
  const top = Math.max(8, stageTop + (first ? first.y * stageHeight : selection.y));

  const fire = (run: (typeof ACTIONS)[number]["run"], style?: MarkStyle) => {
    if (run === "note") onNote();
    else if (run === "translate") onTranslate();
    else if (run === "explain") onExplain();
    else if (style) onMark(style);
  };

  return (
    <div
      className={`action-rail ${handedness}`}
      style={{ left, top }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="color-dots">
        {COLORS.map((color) => (
          <button
            key={color}
            className="dot"
            title="高亮颜色"
            style={{ background: color }}
            onClick={() => onMark("highlight", color)}
          />
        ))}
      </div>
      {ACTIONS.map((action, index) => (
        <button
          key={action.id}
          className="action-chip"
          style={{ animationDelay: `${40 + index * 45}ms` }}
          onClick={() => fire(action.run, action.style)}
        >
          <span>{action.label}</span>
          <kbd>{action.key}</kbd>
        </button>
      ))}
    </div>
  );
}

export { ACTIONS, COLORS };
