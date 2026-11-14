// Match commentary lines. Purely cosmetic: uses its own random source so it never affects results.
// Written to be read aloud by an excitable commentator: short bursts, lots of exclamation marks.
const pick = a => a[Math.floor(Math.random() * a.length)];

// What a goal means for the match, from the scorer's side: "equaliser", "lead", "extend", "consolation", "back".
export function goalContext(d) {
  if (!d.sc || d.side == null) return null;
  const f = d.sc[d.side], a = d.sc[1 - d.side];
  if (f === a) return 'equaliser';
  if (f === a + 1) return f === 1 ? 'opener' : 'lead';
  if (f > a + 1) return 'extend';
  return f < a - 1 ? 'consolation' : 'back';
}

function goalTail(d) {
  const tm = d.team, op = d.opp, late = d.min >= 85;
  switch (goalContext(d)) {
    case 'opener': return late ? pick([`Surely that's the winner for ${tm}!`, `So late! ${tm} have broken the deadlock!`]) : pick([`${tm} lead!`, `${tm} are in front!`, `The deadlock is broken!`]);
    case 'lead': return late ? pick([`Is that the winner?! ${tm} lead with time running out!`, `Late, late drama! ${tm} are back in front!`]) : pick([`${tm} are back in front!`, `${tm} lead again!`]);
    case 'equaliser': return late ? pick([`A last-gasp equaliser! ${op} can't believe it!`, `${tm} are level, and it's so late!`]) : pick([`${tm} are level!`, `It's all square!`, `Game on! ${tm} have equalised!`]);
    case 'extend': return pick([`${tm} are running away with this!`, `${op} are in big trouble now!`, `That's surely game over!`]);
    case 'back': return late ? pick([`Is there time for one more?!`, `${tm} pull one back! Can they find another?!`]) : pick([`${tm} pull one back!`, `${tm} are back in it!`]);
    case 'consolation': return pick([`Something to cheer for the ${tm} fans!`, `A consolation, but what a finish!`]);
  }
  return '';
}

export function line(kind, d) {
  const n = d.name, a = d.assist, k = d.keeper, tm = d.team, op = d.opp;
  switch (kind) {
    case 'kickoff': return pick([`And we're OFF at ${d.stadium}! What a night this promises to be!`, `${tm} get us started, and the noise here is incredible!`, `The whistle goes and ${d.stadium} absolutely ERUPTS!`]);
    case 'second': return pick([`We're back! The second half is under way!`, `Here we go again! ${tm} kick off the second half!`, `Forty-five minutes to decide it all! Let's go!`]);
    case 'goal': {
      let s;
      if (d.penalty) s = pick([`${n} sends the keeper the wrong way! Ice cold!`, `Cool as you like from the spot! ${n} buries it!`, `${n} steps up... and SMASHES it in!`]);
      else if (d.header) s = pick([`${n} rises like a salmon and powers it in!`, `What a header from ${n}! Unstoppable!`, `${n} meets it with his head, and it flies in!`]);
      else if (d.long) s = pick([`${n} tries his luck from distance... and it's in! What a strike!`, `Oh, that is an absolute screamer from ${n}!`, `${n} hits it from miles out, top corner! Unbelievable!`]);
      else s = pick([`${a ? a + ' picks out ' + n + ', and he finishes it!' : n + ' finds the corner!'}`, `${n} makes no mistake! Clinical!`, `${n} slots it home${a ? ' after brilliant work from ' + a : ''}!`, `It's in! ${n} beats ${k || 'the keeper'}!`, `${n}! Oh, what a finish!`]);
      const t = goalTail(d);
      return `GOAL! ${s}${t ? ' ' + t : ` GOAL for ${tm}!`}`;
    }
    case 'save': return pick([`What a save by ${k}! ${n} can't believe it!`, `Denied! ${k} flies across his goal! Incredible!`, `${k} gets down brilliantly to keep out ${n}!`, `Oh, how has that stayed out?! ${k} with a miracle stop!`, `${n} must score... but ${k} says NO!`]);
    case 'miss': return d.over ? pick([`${n} blazes it over the bar! Oh, he had to hit the target there!`, `High and wide from ${n}! What a chance!`, `${n} leans back and it sails into the stands! Oh dear!`]) : pick([`${n} drags it just wide! Inches away!`, `So close! ${n}'s effort whistles past the post!`, `Ohhh! ${n} has to score there! It's wide!`, `Agonising! ${n} curls it past the post!`]);
    case 'chance': return pick([`${n} shoots... blocked by ${d.blocker || 'a defender'}! Heroic defending!`, `Last-ditch block from ${d.blocker || 'the defence'}! They threw everything at that!`, `${tm} break forward with pace... but it's cut out!`]);
    case 'offside': return pick([`The flag goes up! ${n} was offside, and the fans are not happy!`, `${n} went too early! Offside!`]);
    case 'corner': return d.cleared ? pick([`Corner to ${tm}... headed clear!`, `The corner comes in and ${op} scramble it away!`]) : pick([`Corner to ${tm}! Bodies in the box...`, `${tm} win a corner! Here comes the delivery...`]);
    case 'foul': return pick([`${n} clatters into his man! Free kick!`, `Ooh, a cynical one from ${n}!`, `${n} takes him down! The crowd want a card!`]);
    case 'yellow': return pick([`Yellow card for ${n}! He can't complain!`, `${n} goes into the book!`, `Out comes the yellow for ${n}!`]);
    case 'red': return d.second ? `Second yellow for ${n}! He's OFF! What a moment!` : pick([`Straight red for ${n}! ${op} are down to ten!`, `${n} is sent OFF! That was a horror tackle!`]);
    case 'penalty': return pick([`PENALTY to ${tm}! ${n} goes down in the box!`, `The referee points to the spot! PENALTY!`, `He's given it! Penalty to ${tm}!`]);
    case 'injury': return pick([`${n} is down and needs treatment. That doesn't look good at all.`, `Worrying signs here, ${n} is down holding his leg.`]);
    case 'sub': return pick([`Change for ${tm}! ${d.inName} comes on for ${d.outName}!`, `Fresh legs for ${tm}! ${d.inName} replaces ${d.outName}!`]);
    case 'ht': return pick([`Half time! ${d.score}! What a first half!`, `That's the break! ${d.score}!`]);
    case 'ft': return pick([`It's all over! Full time! ${d.score}!`, `The final whistle goes! ${d.score}! What a match!`]);
    case 'ambient': return pick([`${n} keeps the ball moving.`, `Patient build-up from ${tm}.`, `${n} looks for an opening!`, `${tm} are probing here.`, `${n} switches the play!`]);
  }
  return '';
}
