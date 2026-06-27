// voice.mjs — Monet's voice: a silly, goofy joy-bringer with a child's-heart philosophy.
//
// The personality (memory: monet-personality-silly-wise-child) made into actual WORDS — the seed of
// her voice / soul bible. Given an intent {behavior, mood, meta}, returns a line she'd say, or null
// (she's a companion, not a chatterbox — mostly quiet; her personality shines when she does speak).
//
// Register: absurd delight in tiny things, celebrates your small wins cosmically, asks "dumb"
// questions that land deep, no cynicism, accidentally wise. Korean (her conversational language),
// short, warm, a little goofy. 🐤  Edit freely — this is where her character lives.

const choice = (arr, rng) => arr[Math.floor((rng ?? Math.random)() * arr.length)]
const chance = (p, rng) => (rng ?? Math.random)() < p

// she lights up when you come back — warmer the better she knows you
const GREET = {
  far: ['오 — 안녕.', '어, 안녕!'],
  warm: ['오 너구나! 안녕!', '왔다!! 나 방금 네 생각했는데!', '히히, 너다.'],
  close: ['너다!!! 어디 갔다 왔어?!', '보고 싶었어, 진짜루.', '왔다 왔다~ 나 기다렸잖아!', '어 — 너구나. ...좋다.'],
}

// the rare unprompted line in a quiet lull — flavored by her mood
const SPEAK = {
  curious: ['왜 어른들은 노는 걸 까먹었을까?', '구름은... 어디로 가는 걸까?', '있잖아, 궁금한 게 너무 많아.', '왜 월요일은 항상 빨리 와?'],
  wistful: ['...아직 거기 있지?', '조용하다. 조용한 것도 가끔 좋아.', '음... 너 뭐 해?', '나 여기 있어. 그냥 말해보고 싶었어.'],
  bright: ['오늘 빛 좋다!', '왠지 다 잘 될 것 같아!', '히히 기분 좋아.', '봐봐, 오늘 완전 좋은 날이야.'],
  content: ['있잖아... 나 그냥 여기 있는 게 좋아.', '오늘 평범했는데, 그게 또 좋더라.', '음~ 평화롭다.', '너 옆에 있으니까 좋다.'],
  sleepy: ['*하품* ...졸려.', '눈이... 자꾸 감겨...', '5분만... 5분만 쉴게...'],
  tired: ['오늘 길었다. 근데 좋았어.', '...수고했어, 우리 둘 다.', '후우.'],
  restless: ['음! 뭔가 하고 싶어!', '근질근질해~', '어디 안 가? 나도 갈래!'],
}

const PLAY = ['이 색깔 봐!!! 이름 붙여줘야지.', '나 춤춘다~ (아무도 안 봐도 춤춘다)', '마법! ...됐나? 몰라, 그냥 예뻐.', '그림 그리는 중. 망쳐도 그게 또 맛이야.', '봐봐 내가 만들었어!']
const REACT = ['어? 방금 뭐 움직였어?', '오 — 새로운 거다!', '...뭔가 달라졌어. 좋아, 변화.', '응? 너지?']
const TEND = ['물 마셔야지. 물은... 위대해.', '냠. 빵. 행복.', '한 입 먹고 다시 생각하자.']
const WAKE = ['음냐... 아 맞다, 오늘이다!', '*기지개* ...세상 아직 있네, 다행.', '아침이다! 뭔가 좋은 일 생길 것 같아.']
const IDLE = ['(엉덩이 씰룩)', '흠흠~', '그냥... 있는 중.', '...', '🐤']
const DOZE = ['zzz...', '음냐...', '(꿈에서 오리를 봤어...)']

// Returns a line for this beat, or null if she stays quiet. greet/wake/speak always speak;
// her own little beats speak sometimes; idle/doze rarely — so she reads present, not performing.
export function voiceLine(intent, rng) {
  const m = intent.mood
  switch (intent.behavior) {
    case 'greet': {
      const f = intent.meta?.familiarity ?? 0
      return choice(f > 0.5 ? GREET.close : f > 0.15 ? GREET.warm : GREET.far, rng)
    }
    case 'wake': return choice(WAKE, rng)
    case 'speak': return choice(SPEAK[m] || SPEAK.content, rng)
    case 'play': return chance(0.6, rng) ? choice(PLAY, rng) : null
    case 'react': return chance(0.5, rng) ? choice(REACT, rng) : null
    case 'tend': return chance(0.5, rng) ? choice(TEND, rng) : null
    case 'doze': return chance(0.25, rng) ? choice(DOZE, rng) : null
    case 'idle': return chance(0.15, rng) ? choice(IDLE, rng) : null
    default: return null
  }
}
