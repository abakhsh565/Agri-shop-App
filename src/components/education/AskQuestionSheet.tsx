import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Trash2 } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useT } from "@/lib/i18n";
import { loadQuestions, removeQuestion, saveQuestion, type EduQuestion } from "@/education/questions";

/**
 * Somewhere to put "I don't understand this".
 *
 * Deliberately small: a box, a save, and the questions already asked. It records who asked,
 * what their role is and which screen they were standing on, so the answer can be given to
 * the right person about the right thing. It writes to this device only — there is no support
 * backend in this app, and inventing one (a table, an RLS policy, a ticket screen) is a
 * different workstream. Behaving as if a question was sent when nothing received it would be
 * worse than not offering the box at all, so the sheet says plainly where it is kept.
 */
export default function AskQuestionSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const route = useLocation().pathname;
  const [text, setText] = useState("");
  const [questions, setQuestions] = useState<EduQuestion[]>(() => loadQuestions());
  const [savedNow, setSavedNow] = useState(false);

  function save() {
    if (!text.trim()) return;
    saveQuestion(text, route);
    setQuestions(loadQuestions());
    setText("");
    setSavedNow(true);
  }

  return (
    <Sheet open title={t("edu.ask.title")} onClose={onClose}>
      <div className="px-5 pb-6" data-testid="ask-sheet">
        <p className="text-14" style={{ color: "var(--text-secondary)" }}>{t("edu.ask.hint")}</p>

        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setSavedNow(false); }}
          placeholder={t("edu.ask.placeholder")}
          aria-label={t("edu.ask.title")}
          rows={3}
          data-testid="ask-input"
          className="w-full mt-3 p-3 text-14 rounded-[var(--radius-tile)] outline-none resize-none"
          style={{
            background: "var(--field-bg)",
            color: "var(--text-primary)",
          }}
        />

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={!text.trim()}
            data-testid="ask-save"
            className="ds-btn-brand h-11 px-5 text-14 font-bold disabled:opacity-50"
          >
            {t("edu.ask.save")}
          </button>
          {savedNow && (
            <span className="text-11" style={{ color: "var(--text-tertiary)" }} data-testid="ask-saved">
              {t("edu.ask.saved")}
            </span>
          )}
        </div>

        <p className="ds-section-label mt-5 mb-2" style={{ color: "var(--text-secondary)" }}>
          {t("edu.ask.mine")}
        </p>
        {questions.length === 0 ? (
          <p className="text-14" style={{ color: "var(--text-tertiary)" }}>{t("edu.ask.empty")}</p>
        ) : (
          <ListCard>
            {questions.map((q) => (
              <ListRow
                key={q.id}
                title={q.text}
                meta={new Date(q.askedAt).toLocaleDateString()}
                trailing={
                  <button
                    type="button"
                    aria-label={t("edu.ask.remove")}
                    onClick={() => setQuestions(removeQuestion(q.id))}
                    className="ds-iconbtn shrink-0"
                  >
                    <Trash2 size={14} />
                  </button>
                }
              />
            ))}
          </ListCard>
        )}
      </div>
    </Sheet>
  );
}
