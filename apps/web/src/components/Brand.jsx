/*
 * The usahaku wordmark with its author raised like an exponent (usahaku^by geet).
 * `byClassName` sets the superscript's color, so it also reads on the navy band.
 */
export function Wordmark({ byClassName = 'text-slate' }) {
  return (
    <>
      usahaku
      <sup
        className={`relative -top-[0.75em] ml-0.5 align-baseline text-[10px] font-medium leading-none tracking-normal ${byClassName}`}
      >
        by geet
      </sup>
    </>
  );
}
