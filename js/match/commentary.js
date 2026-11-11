// Match commentary lines. Purely cosmetic: uses its own random source so it never affects results.
const pick = a => a[Math.floor(Math.random() * a.length)];
export function line(kind, d) {
  const n = d.name, a = d.assist, k = d.keeper, tm = d.team, op = d.opp;
  switch (kind) {
    case 'kickoff': return pick([`We're under way at ${d.stadium}!`, `${tm} get us started. Enjoy this one.`, `The whistle goes and ${d.stadium} roars.`]);
    case 'second': return pick([`The second half is under way.`, `Back out they come. ${tm} kick off the second half.`]);
    case 'goal':
      if (d.penalty) return pick([`${n} sends the keeper the wrong way. GOAL!`, `Cool as you like from the spot. ${n} scores!`]);
      if (d.header) return pick([`${n} rises highest and heads it in! GOAL!`, `What a header from ${n}!`]);
      if (d.long) return pick([`${n} tries his luck from distance... AND IT'S IN! What a strike!`, `Oh, that is a screamer from ${n}!`]);
      return pick([`${a ? a + ' picks out ' + n + ', and he finishes!' : n + ' finds the corner!'} GOAL for ${tm}!`, `${n} makes no mistake! ${tm} score!`, `GOAL! ${n} slots it home${a ? ' after great work from ' + a : ''}.`, `It's in! ${n} beats ${k || 'the keeper'}!`]);
    case 'save': return pick([`Great save by ${k}! ${n} can't believe it.`, `${n} forces ${k} into a smart stop.`, `${k} gets down well to keep out ${n}.`, `Denied! ${k} is equal to it.`]);
    case 'miss': return d.over ? pick([`${n} blazes it over the bar.`, `High and wide from ${n}.`, `${n} leans back and it sails over.`]) : pick([`${n} drags it just wide of the post!`, `So close! ${n}'s effort whistles past the post.`, `${n} should have hit the target there.`]);
    case 'chance': return pick([`${n} lines up a shot, but ${d.blocker || 'a defender'} blocks it.`, `Last-ditch block from ${d.blocker || 'the defence'}!`, `${tm} break forward, but the attack fizzles out.`]);
    case 'offside': return pick([`The flag goes up. ${n} was offside.`, `${n} timed that run badly. Offside.`]);
    case 'corner': return d.cleared ? pick([`Corner to ${tm}... headed clear.`, `The corner comes in and ${op} clear their lines.`]) : pick([`Corner to ${tm}. Bodies in the box...`, `${tm} win a corner. Here's the delivery...`]);
    case 'foul': return pick([`${n} brings his man down. Free kick.`, `A cynical one from ${n}.`]);
    case 'yellow': return pick([`Yellow card for ${n}.`, `${n} goes into the book.`, `The referee shows ${n} a yellow.`]);
    case 'red': return d.second ? `Second yellow for ${n}, and he's off!` : pick([`Straight red for ${n}! ${op} are down to ten.`, `${n} is sent off! That's a horror tackle.`]);
    case 'penalty': return pick([`PENALTY to ${tm}! ${n} goes down in the box.`, `The referee points to the spot!`]);
    case 'injury': return `${n} is down and needs treatment. That doesn't look good.`;
    case 'sub': return `Substitution for ${tm}: ${d.inName} comes on for ${d.outName}.`;
    case 'ht': return `Half time. ${d.score}.`;
    case 'ft': return `Full time! ${d.score}.`;
    case 'ambient': return pick([`${n} keeps the ball moving.`, `Patient build-up from ${tm}.`, `${n} looks for an opening.`, `${tm} are probing here.`, `${n} switches the play.`]);
  }
  return '';
}
