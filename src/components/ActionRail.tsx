import { tr } from "../lib/i18n";
import type { Handedness, Language, MarkStyle, SelectionPayload } from "../lib/types";

const COLORS = ["#e8c56b", "#8fbf6a", "#e8a0b3", "#7eb6d9"];

const ACTIONS: Array<{
  id: string;
  label: string;
  icon: string;
  key: string;
  run: "highlight" | "underline" | "strike" | "note" | "tag" | "translate" | "explain";
  style?: MarkStyle;
}> = [
  { id: "highlight", label: "高亮", icon: "▰", key: "H", run: "highlight", style: "highlight" },
  { id: "underline", label: "下划线", icon: "U̲", key: "U", run: "underline", style: "underline" },
  { id: "strike", label: "删除线", icon: "S̶", key: "S", run: "strike", style: "strike" },
  { id: "note", label: "备注", icon: "✎", key: "N", run: "note" },
  { id: "tag", label: "标签", icon: "⌑", key: "B", run: "tag" },
  { id: "translate", label: "翻译", icon: "译", key: "T", run: "translate" },
  { id: "explain", label: "解释", icon: "?", key: "E", run: "explain" },
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
  onTag: () => void;
  onTranslate: () => void;
  onExplain: () => void;
  language: Language;
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
  onTag,
  onTranslate,
  onExplain,
  language,
}: Props) {
  const first = selection.rects[0];
  const last = selection.rects.at(-1) ?? first;
  const railW = Math.min(620, stageWidth - 16);
  const anchorX = handedness === "right"
    ? stageLeft + (last ? (last.x + last.w) * stageWidth : selection.x)
    : stageLeft + (first ? first.x * stageWidth : selection.x);
  const left = Math.max(stageLeft + 8, Math.min(anchorX - railW / 2, stageLeft + stageWidth - railW - 8));
  const selectionTop = stageTop + (first ? first.y * stageHeight : selection.y);
  const top = Math.max(stageTop + 8, selectionTop - 62);

  const fire = (run: (typeof ACTIONS)[number]["run"], style?: MarkStyle) => {
    if (run === "note") onNote();
    else if (run === "tag") onTag();
    else if (run === "translate") onTranslate();
    else if (run === "explain") onExplain();
    else if (style) onMark(style);
  };

  return (
    <div
      className={`action-rail ${handedness}`}
      style={{ left, top, width: railW }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="color-dots">
        {COLORS.map((color) => (
          <button
            key={color}
            className="dot"
            title={tr(language, "mark.color")}
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
          <span className="action-icon">{action.icon}</span>
          <span>{tr(language, `mark.${action.id}`)}</span>
          <kbd>{action.key}</kbd>
        </button>
      ))}
    </div>
  );
}

export { ACTIONS, COLORS };
