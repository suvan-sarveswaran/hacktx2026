// Local visual vocabulary. Context selects a word sense, never a recurring setting.
const clean = value => value.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu,' ').trim();
const RECIPES = [
  [/\batoms?\b|\batomic\b/u, 'An enlarged educational atom model: one compact nucleus made of clustered spheres, with a few small electrons surrounding it. The atom itself fills the frame against an uncluttered background.'],
  [/\bneutrons?\b/u, 'A small neutral subatomic particle shown as one luminous sphere, approaching a compact cluster of nucleons. A close-up particle-scale teaching model, with the moving particle dominant.'],
  [/\bxenon\b/u, 'A conceptual particle-scale view of xenon atoms intercepting a few incoming neutron particles. Distinct colored spheres and short motion trails make the absorption readable.'],
  [/\bpump(?:s|ed|ing)?\b/u, 'A single centrifugal pump in a transparent cutaway: a curved impeller turns inside a round housing and pushes blue liquid through an inlet and outlet. The moving mechanism dominates the frame.'],
  [/\bcoolant\b/u, 'A vivid stream of cool blue liquid curls through one transparent glass tube. Individual droplets, a curved meniscus and a few flow arrows make the cooling fluid itself the hero subject.'],
  [/\b(?:electric|electrical) motors?\b|\bmotors?\b/u, 'One electric motor opened to reveal copper coils, a rotor and a central shaft. A few short motion trails communicate rotation. Show a compact object study of this machine.'],
  [/\bdiesel\b|\bgenerators?\b/u, 'One compact diesel generator on a plain workshop floor: a recognizable engine, alternator, exhaust pipe and a single output cable. Present the machine as an isolated mechanical object.'],
  [/\bturbines?\b|\bflywheel\b|\bmomentum\b/u, 'A polished turbine wheel with curved blades, mounted on a short exposed shaft. Sweeping motion arcs communicate coasting rotation and stored momentum. The wheel fills most of the image.'],
  [/\bcontrol rods?\b|\bshutdown rods?\b/u, 'A small array of long control rods lowered through a simple transparent channel model. Use clear vertical motion and distinct rod shapes; frame just this mechanism.'],
  [/\bgraphite\b|\bmoderator\b/u, 'A tactile close-up of dark graphite blocks and one cylindrical graphite component, with a small separated-parts view revealing the material structure.'],
  [/\bsteam\b|\bvapou?r\b/u, 'A sculptural white plume of water vapor curls upward from a few bright droplets. Backlighting reveals delicate swirls and soft translucent edges; the vapor itself fills the frame.'],
  [/\bheat\b|\bthermal\b/u, 'A small warm object emits flowing orange thermal ripples into cool surrounding air. Show heat transfer through a clean thermal-visualization metaphor with a clear warm-to-cool contrast.'],
  [/\breactors?\b|\brbmk\b/u, 'A tabletop cutaway model of a reactor core, with vertical fuel channels, coolant paths and control rods. The compact model fills the frame so its internal arrangement is readable.'],
  [/\bvoltage\b|\bmegawatts?\b|\belectric power\b/u, 'A close-up instrument gauge beside a glowing electrical cable. A moving needle and changing light intensity communicate electrical output without invented numbers or labels.'],
  [/\bbuttons?\b|\baz[\s-]?5\b/u, 'An extreme close-up of one large red emergency button and a fingertip just pressing it. The button and hand are the only prominent objects.'],
  [/\bcars?\b/u, 'A single recognizable car presented as a compact hero object, with readable wheels, bodywork and a small motion cue.'],
  [/\b(?:cold|hot) water\b|\bwater\b/u, 'A clear water droplet splashes into a small shallow pool, sending out bright ripples. Use a macro composition that makes the water surface, droplets and refraction the subject.'],
  [/\bleaf\b|\bleaves\b/u, 'A single leaf seen close enough to reveal its branching veins, gently curved edge and translucent green surface. The leaf is the hero object against a clean backdrop.'],
  [/\bcomputers?\b|\bprocessors?\b/u, 'A single exposed computer processor on a small circuit board, with a few glowing signal paths and a clear central chip. Present a close-up component study.'],
];
const COMPOSITIONS = [
  'Composition: a tight macro crop, with the subject extending toward the frame edges.',
  'Composition: a three-quarter hero view, with generous empty space and one small secondary detail.',
  'Composition: an overhead arrangement, with a clean silhouette and strong separation from the background.',
  'Composition: a diagonal action view, emphasizing motion and a clear cause-and-effect relationship.',
  'Composition: a miniature tabletop demonstration, with a small comparison object for scale.',
  'Composition: a side-view detail study, emphasizing texture and the most relevant moving part.',
];
function variation(text) {let value=2166136261;for(const c of text)value=Math.imul(value^c.charCodeAt(0),16777619);return value>>>0;}

export function independentSceneBrief(focus,context,index) {
  const subject=clean(focus),sense=clean(context);
  let description;
  // Ambiguous nouns use only enough context to pick their meaning.
  if(/^cells?$/u.test(subject))description=/prison|inmate|jail/u.test(sense)?
    'A single empty prison cell with a bunk, barred door and a small window. Frame only the confined room.':
    'One enlarged biological cell, with a translucent membrane, distinct nucleus and a few visible organelles. A microscopic cutaway centered on the cell.';
  else if(/^plants?$/u.test(subject))description=/electric|nuclear|reactor|power station/u.test(sense)?
    'A compact model of an electricity-generating plant, with the main machinery and connections clearly separated.':
    'A single growing plant with leaves, stem and visible roots, presented as a botanical specimen.';
  else if(/^(?:positive )?charge$/u.test(subject))description=/battery|electron|ion|electric|proton/u.test(sense)?
    'A single electrically charged particle, surrounded by a few clean outward field lines. Keep the particle-scale view dominant.':
    'A simple visual metaphor for a charge: one clear focal object with a directional movement cue, presented against an uncluttered background.';
  else description=RECIPES.find(([pattern])=>pattern.test(subject))?.[1];
  description??=`A standalone visual depiction of ${focus}, treated as the single hero subject. Make its shape, defining details or physical action immediately readable, rather than illustrating an entire story.`;
  const composition=COMPOSITIONS[variation(`${focus}:${index}`)%COMPOSITIONS.length];
  return {subject:focus,description,composition};
}
