import type { BookMeta } from "../lib/types";

type Props = {
  tabs: BookMeta[];
  activeId?: string;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
  onImport: () => void;
};

export default function TabBar({ tabs, activeId, onOpen, onClose, onImport }: Props) {
  return (
    <div className="tabbar">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`file-tab ${tab.id === activeId ? "active" : ""}`}
          onClick={() => onOpen(tab.id)}
        >
          <span>{tab.title}</span>
          <i
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab.id);
            }}
          >
            ×
          </i>
        </button>
      ))}
      <button className="file-tab add" onClick={onImport}>
        +
      </button>
    </div>
  );
}
