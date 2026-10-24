import type { Protocol } from './types.js';

/** Adult cardiac arrest — hands-only CPR + AED (AHA 2020 layperson algorithm). */
export const cardiacArrest: Protocol = {
  id: 'cardiac_arrest',
  title: 'Cardiac arrest — Hands-only CPR',
  spokenName: 'CPR',
  triggers: ['person collapsed', 'not breathing or only gasping', 'no response to shouting and shaking', 'unresponsive on the ground'],
  sceneSafety: ['Make sure the area is safe for you — traffic, fire, water, electricity.'],
  callEmergencyOnEntry: true,
  entry: 'check_response',
  steps: {
    check_response: {
      id: 'check_response',
      say: 'Kneel beside them. Tap their shoulder hard and shout, "Are you okay?"',
      ask: 'Did they respond — any movement, sound, or opening their eyes?',
      branches: [
        { when: 'yes / they responded', next: 'responsive' },
        { when: 'no / no response', next: 'call_and_aed' },
      ],
    },
    responsive: {
      id: 'responsive',
      say: 'They are responsive. Keep them still and calm. Stay with them until help arrives.',
      detail: 'If they become unresponsive again, tell me immediately and we will restart.',
      next: null,
    },
    call_and_aed: {
      id: 'call_and_aed',
      say: 'Call 911 now on speaker. If anyone else is here, send them to find an AED.',
      detail: 'An AED is a defibrillator. They are in a cabinet marked with a heart and lightning bolt, often near entrances, gyms, and pools.',
      ar: { kind: 'highlight', targets: ['aed'] },
      escalate: true,
      next: 'check_breathing',
    },
    check_breathing: {
      id: 'check_breathing',
      say: 'Look at their chest for five seconds. Are they breathing normally, or just gasping?',
      ask: 'Are they breathing normally?',
      branches: [
        { when: 'breathing normally', next: 'recovery' },
        { when: 'not breathing / gasping / not sure', next: 'position_hands' },
      ],
    },
    recovery: {
      id: 'recovery',
      say: 'They are breathing. Roll them gently onto their side with their head tilted back. Watch their breathing until help arrives.',
      ar: { kind: 'recovery_position' },
      next: 'monitor',
    },
    monitor: {
      id: 'monitor',
      say: 'Stay with them. Tell me if their breathing stops or changes.',
      loop: { remindEverySec: 30, reminders: ['Still breathing? Watch the chest rise.'], exitWhen: ['breathing stops', 'help arrives'] },
      next: null,
    },
    position_hands: {
      id: 'position_hands',
      say: 'Put the heel of one hand on the center of their chest, between the nipples. Put your other hand on top and lock your fingers.',
      ar: { kind: 'hand_position', target: 'chest_center' },
      next: 'compress',
    },
    compress: {
      id: 'compress',
      say: 'Arms straight, shoulders over your hands. Push hard and fast — at least two inches deep. Follow my beat.',
      detail: 'Rate is 100 to 120 per minute. Let the chest come all the way back up between pushes. Do not stop unless an AED is ready, they wake up, or help takes over.',
      ar: { kind: 'cpr_metronome', bpm: 110 },
      loop: {
        remindEverySec: 20,
        reminders: [
          'Push hard. Let the chest fully recoil.',
          'You are doing great. Keep going with the beat.',
          'If you get tired and someone is here, swap every two minutes.',
          'Has anyone found an AED?',
        ],
        exitWhen: ['AED arrives', 'person moves or breathes', 'EMS takes over', 'too exhausted and no one to swap'],
      },
      next: 'aed_arrives',
    },
    aed_arrives: {
      id: 'aed_arrives',
      say: 'Turn the AED on and follow its voice. Bare the chest, put the pads where the pictures show.',
      detail: 'One pad on the upper right chest below the collarbone, one on the lower left side below the armpit. Do not stop compressions until the AED tells you to.',
      next: 'aed_analyze',
    },
    aed_analyze: {
      id: 'aed_analyze',
      say: 'When the AED says "analyzing", nobody touch them. If it says shock, make sure everyone is clear and press the button.',
      next: 'resume_after_shock',
    },
    resume_after_shock: {
      id: 'resume_after_shock',
      say: 'Immediately restart compressions. Keep going until the AED speaks again or paramedics take over.',
      ar: { kind: 'cpr_metronome', bpm: 110 },
      loop: { remindEverySec: 20, reminders: ['Keep pushing. The AED will tell you when to stop.'], exitWhen: ['EMS takes over', 'person moves'] },
      next: null,
    },
  },
  doNot: [
    'Do not stop compressions to check for a pulse — laypeople should not check pulses.',
    'Do not give rescue breaths unless you are trained and willing; hands-only CPR is correct.',
    'Do not put anything in their mouth.',
    'Do not move them unless the scene is unsafe.',
  ],
  redFlags: ['Scene becomes unsafe', 'Rescuer injured'],
};

/** Severe bleeding — Stop the Bleed. */
export const severeBleeding: Protocol = {
  id: 'severe_bleeding',
  title: 'Severe bleeding — Stop the Bleed',
  spokenName: 'bleeding control',
  triggers: ['blood pooling or spurting', 'blood soaking through clothing', 'amputation', 'deep wound to limb or torso'],
  sceneSafety: ['Make sure whatever caused the injury is no longer a danger to you.', 'Use gloves or a plastic bag over your hands if you can.'],
  callEmergencyOnEntry: true,
  entry: 'find_source',
  steps: {
    find_source: {
      id: 'find_source',
      say: 'Call 911. Then find where the blood is coming from — open or cut away clothing if you need to.',
      ar: { kind: 'highlight', targets: ['bleeding_site'] },
      escalate: true,
      ask: 'Where is the bleeding — an arm or leg, or the neck, chest, abdomen, or groin?',
      branches: [
        { when: 'arm or leg', next: 'limb_pressure' },
        { when: 'neck, torso, groin, or junction', next: 'pack_and_press' },
        { when: 'not sure', next: 'direct_pressure' },
      ],
    },
    direct_pressure: {
      id: 'direct_pressure',
      say: 'Press hard directly on the wound with both hands and a cloth. Harder than feels comfortable. Do not let go.',
      loop: { remindEverySec: 25, reminders: ['Keep pressing. Do not lift to check — add more cloth on top.'], exitWhen: ['EMS arrives', 'bleeding controlled'] },
      next: null,
    },
    limb_pressure: {
      id: 'limb_pressure',
      say: 'Press hard directly on the wound with both hands and a cloth. Lean your weight into it.',
      ask: 'After thirty seconds of hard pressure, is blood still coming through?',
      branches: [
        { when: 'yes, still bleeding heavily', next: 'tourniquet' },
        { when: 'no, slowing or stopped', next: 'hold_pressure' },
      ],
    },
    hold_pressure: {
      id: 'hold_pressure',
      say: 'Good. Keep pressing until paramedics take over. Do not lift the cloth to look.',
      loop: { remindEverySec: 30, reminders: ['Keep steady pressure. If it soaks through, add more on top.'], exitWhen: ['EMS arrives'] },
      next: null,
    },
    tourniquet: {
      id: 'tourniquet',
      say: 'Use a tourniquet if there is one, or a belt or strap. Place it two to three inches above the wound, not on a joint.',
      ar: { kind: 'tourniquet_guide' },
      next: 'tighten',
    },
    tighten: {
      id: 'tighten',
      say: 'Tighten until the bleeding stops. It will hurt a lot — that means it is working. Note the time.',
      ar: { kind: 'timer', seconds: 0, label: 'Tourniquet applied' },
      next: 'tq_hold',
    },
    tq_hold: {
      id: 'tq_hold',
      say: 'Do not loosen it. Tell paramedics the time it went on. Keep them warm and talking.',
      loop: { remindEverySec: 30, reminders: ['Keep them warm. Keep talking to them.'], exitWhen: ['EMS arrives'] },
      next: null,
    },
    pack_and_press: {
      id: 'pack_and_press',
      say: 'Pack the wound: push cloth or gauze deep into the wound with your fingers, then press hard on top with both hands.',
      next: 'direct_pressure',
    },
  },
  doNot: [
    'Do not remove an object stuck in the wound — press around it.',
    'Do not loosen a tourniquet once it is on.',
    'Do not put a tourniquet on the neck or torso.',
  ],
  redFlags: ['Person becomes unresponsive and stops breathing → switch to CPR'],
};

export const chokingAdult: Protocol = {
  id: 'choking_adult',
  title: 'Choking — adult or child over 1',
  spokenName: 'choking',
  triggers: ['hands at throat', 'cannot speak or cough', 'turning blue', 'silent struggling while eating'],
  sceneSafety: [],
  callEmergencyOnEntry: true,
  entry: 'assess',
  steps: {
    assess: {
      id: 'assess',
      say: 'Ask them: "Are you choking? Can you speak?"',
      ask: 'Can they cough forcefully or speak?',
      branches: [
        { when: 'yes, coughing or speaking', next: 'encourage_cough' },
        { when: 'no, silent / cannot breathe', next: 'back_blows' },
        { when: 'unresponsive / collapsed', next: 'unresponsive' },
      ],
    },
    encourage_cough: {
      id: 'encourage_cough',
      say: 'Tell them to keep coughing hard. Stay with them. If they stop being able to cough or speak, tell me.',
      next: null,
    },
    back_blows: {
      id: 'back_blows',
      say: 'Call 911 or have someone do it. Stand behind them, lean them forward, and give five hard blows between the shoulder blades with the heel of your hand.',
      escalate: true,
      next: 'abdominal_thrusts',
    },
    abdominal_thrusts: {
      id: 'abdominal_thrusts',
      say: 'Now five abdominal thrusts: fist just above their belly button, grab it with your other hand, pull sharply in and up.',
      detail: 'If they are pregnant or very large, do chest thrusts instead — fist on the center of the breastbone.',
      ask: 'Did the object come out, or are they breathing now?',
      branches: [
        { when: 'yes', next: 'cleared' },
        { when: 'no', next: 'repeat' },
        { when: 'they collapsed', next: 'unresponsive' },
      ],
    },
    repeat: {
      id: 'repeat',
      say: 'Keep alternating: five back blows, five thrusts. Keep going until it comes out or they collapse.',
      next: 'abdominal_thrusts',
    },
    cleared: {
      id: 'cleared',
      say: 'Good. Have them sit and breathe. They should still be checked by a doctor — thrusts can cause internal injury.',
      next: null,
    },
    unresponsive: {
      id: 'unresponsive',
      say: 'Lower them to the ground on their back. Start CPR now — chest compressions can push the object out.',
      detail: 'Each time you open the mouth, look for the object and remove it only if you can see it.',
      next: null,
    },
  },
  doNot: ['Do not do a blind finger sweep.', 'Do not slap the back of someone who is still coughing effectively.'],
  redFlags: ['Collapse → CPR protocol'],
};

export const stroke: Protocol = {
  id: 'stroke',
  title: 'Suspected stroke — F.A.S.T.',
  spokenName: 'stroke check',
  triggers: ['face drooping', 'one-sided weakness', 'slurred speech', 'sudden confusion', 'sudden severe headache'],
  sceneSafety: [],
  callEmergencyOnEntry: true,
  entry: 'face',
  steps: {
    face: {
      id: 'face',
      say: 'Ask them to smile.',
      ask: 'Does one side of their face droop?',
      branches: [{ when: 'yes', next: 'call' }, { when: 'no', next: 'arms' }],
    },
    arms: {
      id: 'arms',
      say: 'Ask them to raise both arms.',
      ask: 'Does one arm drift down or not lift?',
      branches: [{ when: 'yes', next: 'call' }, { when: 'no', next: 'speech' }],
    },
    speech: {
      id: 'speech',
      say: 'Ask them to repeat a simple sentence, like "the sky is blue".',
      ask: 'Is their speech slurred, strange, or missing?',
      branches: [{ when: 'yes', next: 'call' }, { when: 'no', next: 'unclear' }],
    },
    call: {
      id: 'call',
      say: 'Call 911 right now and say "possible stroke". Note the exact time symptoms started — the hospital will ask.',
      ar: { kind: 'timer', seconds: 0, label: 'Symptom onset' },
      escalate: true,
      next: 'wait',
    },
    wait: {
      id: 'wait',
      say: 'Keep them lying down with head slightly raised. Nothing to eat or drink. Stay calm with them.',
      loop: { remindEverySec: 40, reminders: ['Are they still awake and breathing? Note any changes for the paramedics.'], exitWhen: ['EMS arrives'] },
      next: null,
    },
    unclear: {
      id: 'unclear',
      say: 'No clear stroke signs, but sudden symptoms still need a doctor. If anything worsens, call 911 immediately.',
      next: null,
    },
  },
  doNot: ['Do not give aspirin — some strokes are bleeds.', 'Do not let them drive themselves.'],
  redFlags: ['Becomes unresponsive → check breathing, CPR protocol'],
};

export const seizure: Protocol = {
  id: 'seizure',
  title: 'Seizure',
  spokenName: 'seizure care',
  triggers: ['convulsing', 'rhythmic jerking', 'stiff then shaking', 'fell and is twitching'],
  sceneSafety: ['Move hard or sharp objects away from them.'],
  callEmergencyOnEntry: false,
  entry: 'protect',
  steps: {
    protect: {
      id: 'protect',
      say: 'Clear the space around them. Put something soft under their head. Start timing the seizure.',
      ar: { kind: 'timer', seconds: 0, label: 'Seizure duration' },
      next: 'wait',
    },
    wait: {
      id: 'wait',
      say: 'Do not hold them down or put anything in their mouth. Just keep them safe and wait.',
      ask: 'Has it lasted more than five minutes, are they injured, in water, pregnant, or did a second seizure start?',
      branches: [{ when: 'yes', next: 'call' }, { when: 'no', next: 'after' }],
    },
    call: {
      id: 'call',
      say: 'Call 911 now.',
      escalate: true,
      next: 'after',
    },
    after: {
      id: 'after',
      say: 'When the shaking stops, roll them onto their side. Stay with them. They will be confused — speak calmly.',
      ar: { kind: 'recovery_position' },
      next: null,
    },
  },
  doNot: ['Do not restrain them.', 'Do not put anything in their mouth.', 'Do not give food or water until fully awake.'],
  redFlags: ['Not breathing after the seizure stops → CPR protocol'],
};

export const anaphylaxis: Protocol = {
  id: 'anaphylaxis',
  title: 'Severe allergic reaction',
  spokenName: 'allergy response',
  triggers: ['swelling of lips or face', 'hives plus trouble breathing', 'known allergy exposure', 'wheezing after eating or sting'],
  sceneSafety: [],
  callEmergencyOnEntry: true,
  entry: 'epi',
  steps: {
    epi: {
      id: 'epi',
      say: 'Call 911. Ask if they have an epinephrine pen — an EpiPen — and help them use it on the outer thigh now.',
      detail: 'Remove the blue safety cap, press the orange end hard against the outer thigh, hold for three seconds. It can go through clothing.',
      escalate: true,
      next: 'position',
    },
    position: {
      id: 'position',
      say: 'Have them lie down with legs raised, unless breathing is easier sitting up. Loosen tight clothing.',
      next: 'monitor',
    },
    monitor: {
      id: 'monitor',
      say: 'If they are not better in five to fifteen minutes and there is a second pen, use it.',
      loop: { remindEverySec: 60, reminders: ['How is their breathing? Any better?'], exitWhen: ['EMS arrives'] },
      next: null,
    },
  },
  doNot: ['Do not let them stand or walk suddenly.', 'Do not wait to see if it gets better before calling.'],
  redFlags: ['Stops breathing → CPR protocol'],
};

export const burns: Protocol = {
  id: 'burns',
  title: 'Burns',
  spokenName: 'burn care',
  triggers: ['burned skin', 'scald', 'clothing on fire', 'contact with flame or chemicals'],
  sceneSafety: ['Stop the burning first — stop, drop, and roll, or remove from the heat source.'],
  callEmergencyOnEntry: false,
  entry: 'cool',
  steps: {
    cool: {
      id: 'cool',
      say: 'Run cool — not ice-cold — water over the burn for at least ten minutes. Remove rings and watches nearby.',
      ar: { kind: 'timer', seconds: 600, label: 'Cooling' },
      ask: 'Is the burn larger than their palm, on the face, hands, genitals, or a joint, white or charred, or from chemicals or electricity?',
      branches: [{ when: 'yes', next: 'call' }, { when: 'no', next: 'cover' }],
    },
    call: {
      id: 'call',
      say: 'Call 911. Keep cooling while you wait.',
      escalate: true,
      next: 'cover',
    },
    cover: {
      id: 'cover',
      say: 'Cover loosely with clean plastic wrap or a clean, dry cloth. Do not pop blisters. Do not use butter or ointments.',
      next: null,
    },
  },
  doNot: ['Do not use ice.', 'Do not remove clothing stuck to the burn.', 'Do not apply creams, butter, or toothpaste.'],
  redFlags: ['Burns around the mouth or difficulty breathing → call 911 immediately'],
};

export const opioidOverdose: Protocol = {
  id: 'opioid_overdose',
  title: 'Suspected opioid overdose',
  spokenName: 'overdose response',
  triggers: ['unresponsive with slow or no breathing', 'pinpoint pupils', 'blue lips', 'drug paraphernalia nearby', 'gurgling or snoring sounds'],
  sceneSafety: ['Watch for needles.'],
  callEmergencyOnEntry: true,
  entry: 'rouse',
  steps: {
    rouse: {
      id: 'rouse',
      say: 'Shout their name and rub your knuckles hard on their breastbone.',
      ask: 'Did they wake up?',
      branches: [{ when: 'yes', next: 'awake' }, { when: 'no', next: 'naloxone' }],
    },
    awake: {
      id: 'awake',
      say: 'Keep them awake and sitting up. Call 911 anyway — they can stop breathing again.',
      escalate: true,
      next: null,
    },
    naloxone: {
      id: 'naloxone',
      say: 'Call 911. If there is naloxone — Narcan — spray it in one nostril now.',
      detail: 'Peel the package, put the nozzle in a nostril, press the plunger. If no response in two to three minutes, give a second dose in the other nostril.',
      escalate: true,
      next: 'breathing',
    },
    breathing: {
      id: 'breathing',
      say: 'Check breathing. If they are not breathing normally, start chest compressions and follow my beat.',
      ar: { kind: 'cpr_metronome', bpm: 110 },
      ask: 'Are they breathing normally?',
      branches: [{ when: 'yes', next: 'recovery' }, { when: 'no', next: 'cpr' }],
    },
    cpr: {
      id: 'cpr',
      say: 'Hands in the center of the chest. Push hard and fast. Keep going until they breathe or help arrives.',
      ar: { kind: 'cpr_metronome', bpm: 110 },
      loop: { remindEverySec: 20, reminders: ['Keep going. Second Narcan dose after two minutes if no change.'], exitWhen: ['breathing resumes', 'EMS arrives'] },
      next: null,
    },
    recovery: {
      id: 'recovery',
      say: 'Roll them onto their side. Stay with them until paramedics arrive — naloxone wears off.',
      ar: { kind: 'recovery_position' },
      next: null,
    },
  },
  doNot: ['Do not leave them alone.', 'Do not put them in a cold shower.', 'Do not try to make them vomit.'],
  redFlags: [],
};

export const unresponsiveBreathing: Protocol = {
  id: 'unresponsive_breathing',
  title: 'Unresponsive but breathing',
  spokenName: 'recovery position',
  triggers: ['unconscious but chest moving', 'passed out', 'not waking up but breathing'],
  sceneSafety: [],
  callEmergencyOnEntry: true,
  entry: 'position',
  steps: {
    position: {
      id: 'position',
      say: 'Call 911. Roll them onto their side, top knee bent, head tilted back so the airway stays open.',
      ar: { kind: 'recovery_position' },
      escalate: true,
      next: 'monitor',
    },
    monitor: {
      id: 'monitor',
      say: 'Watch their chest. If breathing stops, roll them onto their back and tell me — we will start CPR.',
      loop: { remindEverySec: 30, reminders: ['Still breathing?'], exitWhen: ['breathing stops', 'EMS arrives'] },
      next: null,
    },
  },
  doNot: ['Do not give anything by mouth.', 'Do not leave them on their back unattended.'],
  redFlags: ['Breathing stops → CPR'],
};

export const heatIllness: Protocol = {
  id: 'heat_illness',
  title: 'Heat stroke / exhaustion',
  spokenName: 'heat emergency',
  triggers: ['collapsed in heat', 'hot red skin', 'confusion in hot environment', 'stopped sweating'],
  sceneSafety: [],
  callEmergencyOnEntry: false,
  entry: 'assess',
  steps: {
    assess: {
      id: 'assess',
      say: 'Get them into shade or air conditioning now.',
      ask: 'Are they confused, unresponsive, having a seizure, or is their skin hot and dry?',
      branches: [{ when: 'yes', next: 'stroke' }, { when: 'no', next: 'exhaustion' }],
    },
    stroke: {
      id: 'stroke',
      say: 'This is heat stroke. Call 911. Cool them aggressively: cold water on skin, ice packs to neck, armpits, groin, fan them.',
      escalate: true,
      next: null,
    },
    exhaustion: {
      id: 'exhaustion',
      say: 'Loosen clothing, cool with wet cloths, and give sips of water if they are fully alert. If no better in thirty minutes, call for help.',
      next: null,
    },
  },
  doNot: ['Do not give fluids to someone who is confused or vomiting.'],
  redFlags: ['Unresponsive → recovery position / CPR'],
};

export const hypothermia: Protocol = {
  id: 'hypothermia',
  title: 'Hypothermia',
  spokenName: 'cold emergency',
  triggers: ['shivering violently or stopped shivering', 'confused in the cold', 'pulled from cold water', 'slurred speech in cold'],
  sceneSafety: [],
  callEmergencyOnEntry: true,
  entry: 'shelter',
  steps: {
    shelter: {
      id: 'shelter',
      say: 'Call 911. Get them out of the wind and off the cold ground. Remove wet clothing and wrap them in anything dry.',
      escalate: true,
      next: 'warm',
    },
    warm: {
      id: 'warm',
      say: 'Warm the core first — chest, neck, groin — with blankets or your body heat. Handle them gently.',
      next: null,
    },
  },
  doNot: ['Do not rub arms and legs.', 'Do not use hot water or direct heat.', 'Do not give alcohol.'],
  redFlags: ['Not breathing → CPR (continue longer than usual; cold patients can recover)'],
};

export const medicalProtocols: Protocol[] = [
  cardiacArrest,
  severeBleeding,
  chokingAdult,
  stroke,
  seizure,
  anaphylaxis,
  burns,
  opioidOverdose,
  unresponsiveBreathing,
  heatIllness,
  hypothermia,
];
