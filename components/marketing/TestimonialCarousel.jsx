'use client';
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Quote, Star, ChevronLeft, ChevronRight } from 'lucide-react';
import { Reveal } from './Reveal';
import { TESTIMONIALS } from './testimonials';

const GRADIENTS = [
  'from-blue-500 to-indigo-600',
  'from-emerald-500 to-teal-600',
  'from-violet-500 to-purple-600',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600',
];

function initials(name) {
  return name
    .replace(/,.*$/, '')
    .replace(/^Dr\.\s*/, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

const variants = {
  enter: (dir) => ({ opacity: 0, x: dir * 80, scale: 0.96 }),
  center: { opacity: 1, x: 0, scale: 1 },
  exit: (dir) => ({ opacity: 0, x: dir * -80, scale: 0.96 }),
};

export default function TestimonialCarousel() {
  const [[index, dir], setPage] = useState([0, 1]);
  const [paused, setPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const total = TESTIMONIALS.length;

  const go = useCallback(
    (step) => setPage(([i]) => [(i + step + total) % total, step]),
    [total]
  );
  const jump = (target) => setPage(([i]) => [target, target >= i ? 1 : -1]);

  useEffect(() => {
    setReduceMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  useEffect(() => {
    if (paused || reduceMotion) return undefined;
    const t = setInterval(() => go(1), 6000);
    return () => clearInterval(t);
  }, [paused, reduceMotion, go]);

  const t = TESTIMONIALS[index];

  return (
    <section className="bg-gradient-to-b from-white to-blue-50/60 border-t border-gray-100">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <Reveal className="text-center">
          <p className="text-xs font-bold tracking-widest uppercase text-brand mb-3">Testimonials</p>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
            What teams like yours say
          </h2>
        </Reveal>

        <div
          className="relative mt-12"
          role="group"
          aria-roledescription="carousel"
          aria-label="Customer testimonials"
          tabIndex={0}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') go(-1);
            if (e.key === 'ArrowRight') go(1);
          }}
        >
          {/* Stacked cards behind the active one for depth */}
          <div aria-hidden className="absolute inset-x-6 -bottom-3 h-full rounded-3xl bg-white/70 border border-gray-100 shadow-sm" />
          <div aria-hidden className="absolute inset-x-12 -bottom-6 h-full rounded-3xl bg-white/40 border border-gray-100" />

          <div className="relative overflow-hidden rounded-3xl bg-white border border-gray-100 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
            <Quote aria-hidden className="absolute -top-2 right-6 w-28 h-28 text-blue-50" strokeWidth={1.5} />
            <AnimatePresence mode="wait" custom={dir} initial={false}>
              <motion.figure
                key={index}
                custom={dir}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.35, ease: [0.22, 0.68, 0, 1] }}
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.25}
                onDragEnd={(_, info) => {
                  if (info.offset.x < -60) go(1);
                  else if (info.offset.x > 60) go(-1);
                }}
                className="relative px-6 sm:px-14 py-10 sm:py-14 cursor-grab active:cursor-grabbing"
                aria-live="polite"
              >
                <div className="flex items-center gap-1 text-amber-400" aria-label={`${t.rating} out of 5 stars`}>
                  {Array.from({ length: t.rating }).map((_, i) => (
                    <Star key={i} className="w-5 h-5 fill-current" />
                  ))}
                </div>
                <blockquote className="mt-5 text-lg sm:text-2xl font-semibold text-gray-900 leading-snug tracking-tight">
                  “{t.quote}”
                </blockquote>
                <figcaption className="mt-8 flex items-center gap-4">
                  <div
                    className={`w-12 h-12 rounded-full bg-gradient-to-br ${GRADIENTS[index % GRADIENTS.length]} text-white font-bold flex items-center justify-center shadow-md`}
                  >
                    {initials(t.name)}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900 text-sm">{t.name}</p>
                    <p className="text-xs text-gray-500">{t.role}, {t.company}</p>
                  </div>
                  <span className="ml-auto hidden sm:inline-block px-3 py-1 rounded-full bg-blue-50 text-brand text-[11px] font-semibold">
                    {t.module}
                  </span>
                </figcaption>
              </motion.figure>
            </AnimatePresence>
          </div>
        </div>

        <div className="mt-10 flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous testimonial"
            className="w-10 h-10 rounded-full border border-gray-200 bg-white text-gray-600 hover:text-brand hover:border-brand/40 hover:shadow-md transition-all flex items-center justify-center"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            {TESTIMONIALS.map((item, i) => (
              <button
                key={item.name}
                type="button"
                onClick={() => jump(i)}
                aria-label={`Show testimonial ${i + 1} of ${total}`}
                aria-current={i === index}
                className={`h-2 rounded-full transition-all duration-300 ${
                  i === index ? 'w-8 bg-brand' : 'w-2 bg-gray-300 hover:bg-gray-400'
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next testimonial"
            className="w-10 h-10 rounded-full border border-gray-200 bg-white text-gray-600 hover:text-brand hover:border-brand/40 hover:shadow-md transition-all flex items-center justify-center"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </section>
  );
}
