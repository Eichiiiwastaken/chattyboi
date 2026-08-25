import { motion } from "framer-motion";
import {
  Code2Icon,
  CompassIcon,
  LightbulbIcon,
  PenLineIcon,
} from "lucide-react";

const STARTERS = [
  {
    label: "Build something",
    prompt: "Help me build a small app from an idea.",
    icon: Code2Icon,
  },
  {
    label: "Explore an idea",
    prompt: "Help me explore an idea from a few different perspectives.",
    icon: CompassIcon,
  },
  {
    label: "Explain a concept",
    prompt: "Explain a difficult concept to me in plain language.",
    icon: LightbulbIcon,
  },
  {
    label: "Write & polish",
    prompt: "Help me draft and polish something I am writing.",
    icon: PenLineIcon,
  },
];

export const Greeting = ({
  onSelectPrompt,
}: {
  onSelectPrompt: (prompt: string) => void;
}) => {
  return (
    <div className="flex w-full flex-col items-center px-4" key="overview">
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="text-center font-semibold text-2xl tracking-tight text-foreground md:text-3xl"
        initial={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.35, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        What can I help with?
      </motion.div>
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="mt-3 text-center text-muted-foreground/80 text-sm"
        initial={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.5, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        Choose a model and start typing. Turn on web search when you need
        current sources.
      </motion.div>
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="mt-6 grid w-full max-w-lg grid-cols-2 gap-2"
        initial={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.62, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        {STARTERS.map((starter) => {
          const Icon = starter.icon;

          return (
            <button
              className="pointer-events-auto flex min-h-11 items-center gap-2.5 rounded-xl border border-border/40 bg-card/35 px-3 text-left text-[12px] font-medium text-muted-foreground shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:bg-accent/50 hover:text-foreground hover:shadow-[var(--shadow-card)] sm:text-[13px]"
              key={starter.label}
              onClick={() => onSelectPrompt(starter.prompt)}
              type="button"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
                <Icon className="size-3.5" />
              </span>
              <span>{starter.label}</span>
            </button>
          );
        })}
      </motion.div>
    </div>
  );
};
