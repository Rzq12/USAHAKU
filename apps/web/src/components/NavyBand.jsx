const DOTS = [
  { className: 'left-[6%] top-[18%] h-5 w-5 rotate-[-8deg] bg-brand-yellow' },
  { className: 'left-[14%] top-[62%] h-3 w-3 rotate-[12deg] bg-brand-pink' },
  { className: 'left-[3%] top-[78%] h-4 w-4 rotate-6 bg-brand-teal' },
  { className: 'right-[7%] top-[14%] h-4 w-4 rotate-12 bg-brand-orange' },
  { className: 'right-[15%] top-[52%] h-6 w-6 rotate-[-10deg] bg-[#7b3ff2]' },
  { className: 'right-[4%] top-[74%] h-3 w-3 rotate-[20deg] bg-brand-yellow' },
];

function Wires() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full text-[#2d4074]"
      preserveAspectRatio="none"
      viewBox="0 0 1200 400"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
    >
      <path d="M0 330C160 300 210 150 330 130S520 60 560 0" />
      <path d="M0 370C200 340 260 200 380 170S600 90 660 0" />
      <path d="M1200 60C1040 90 990 240 870 270S680 340 640 400" />
      <path d="M1200 110C1000 130 960 270 820 310S610 360 560 400" />
    </svg>
  );
}

/** The navy band with sticky-note dots and wires from the design direction. Decorative only. */
export function NavyBand({ children, className = '', decorated = true }) {
  return (
    <section className={`relative isolate overflow-hidden bg-navy text-white ${className}`}>
      {decorated && (
        <div aria-hidden="true" className="absolute inset-0 -z-10 hidden sm:block">
          <Wires />
          {DOTS.map((dot) => (
            <span key={dot.className} className={`sticky-dot ${dot.className}`} />
          ))}
        </div>
      )}
      {children}
    </section>
  );
}
