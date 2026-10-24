import type { Protocol } from './types.js';

export const structureFire: Protocol = {
  id: 'structure_fire',
  title: 'Building fire',
  spokenName: 'fire evacuation',
  triggers: ['visible flames indoors', 'thick smoke', 'fire alarm with smoke', 'smell of burning plus haze'],
  sceneSafety: ['Your job is to get out, not to fight the fire.'],
  callEmergencyOnEntry: true,
  entry: 'size_up',
  steps: {
    size_up: {
      id: 'size_up',
      say: 'Is the fire small — smaller than a trash can — and is there an extinguisher within reach?',
      ar: { kind: 'highlight', targets: ['fire_extinguisher', 'exit'] },
      ask: 'Small fire with an extinguisher nearby, and a clear exit behind you?',
      branches: [{ when: 'yes', next: 'extinguish' }, { when: 'no', next: 'leave' }],
    },
    extinguish: {
      id: 'extinguish',
      say: 'Keep the exit behind you. Pull the pin, aim at the base, squeeze, sweep side to side. If it does not go out in seconds, leave.',
      next: 'leave',
    },
    leave: {
      id: 'leave',
      say: 'Leave now. Stay low under the smoke. Alert others as you go. Do not stop for belongings.',
      ar: { kind: 'arrow_to', target: 'exit' },
      escalate: true,
      next: 'doors',
    },
    doors: {
      id: 'doors',
      say: 'Before opening any door, feel it with the back of your hand. If it is hot, do not open it — use another way.',
      next: 'outside',
    },
    outside: {
      id: 'outside',
      say: 'Once outside, call 911 and stay out. Go to a meeting point and account for everyone. Never go back in.',
      next: null,
    },
  },
  doNot: ['Do not use elevators.', 'Do not open a hot door.', 'Do not go back inside for anything.'],
  redFlags: ['Trapped → close doors, seal gaps with cloth, signal from a window, call 911 with your exact location'],
};

export const earthquake: Protocol = {
  id: 'earthquake',
  title: 'Earthquake',
  spokenName: 'earthquake safety',
  triggers: ['ground shaking', 'objects falling from shelves', 'building swaying', 'cracks appearing'],
  sceneSafety: [],
  callEmergencyOnEntry: false,
  entry: 'drop',
  steps: {
    drop: {
      id: 'drop',
      say: 'Drop to your hands and knees right now. Cover your head and neck. Get under a sturdy table if one is close.',
      next: 'hold',
    },
    hold: {
      id: 'hold',
      say: 'Hold on until the shaking stops. Stay away from windows and anything that can fall.',
      loop: { remindEverySec: 15, reminders: ['Stay down. Cover your head.'], exitWhen: ['shaking stops'] },
      next: 'after',
    },
    after: {
      id: 'after',
      say: 'Shaking stopped. Expect aftershocks. Check yourself for injuries, then look around for others.',
      ask: 'Is anyone hurt, or do you smell gas or see fire?',
      branches: [
        { when: 'someone hurt', next: 'injured' },
        { when: 'gas smell or fire', next: 'gas' },
        { when: 'no', next: 'evacuate' },
      ],
    },
    injured: {
      id: 'injured',
      say: 'Tell me what you see and I will switch to the right first-aid steps. Call 911 if lines are working — use text if calls fail.',
      escalate: true,
      next: null,
    },
    gas: {
      id: 'gas',
      say: 'Do not flip any switches. Open a window if you can and leave the building immediately. Shut off gas only if you know how.',
      ar: { kind: 'arrow_to', target: 'exit' },
      escalate: true,
      next: 'evacuate',
    },
    evacuate: {
      id: 'evacuate',
      say: 'If the building looks damaged, get out carefully and move to open ground away from walls, poles, and power lines.',
      ar: { kind: 'highlight', targets: ['hazard', 'exit'] },
      next: null,
    },
  },
  doNot: ['Do not run outside while it is shaking.', 'Do not stand in a doorway.', 'Do not use elevators.', 'Do not light matches or candles after.'],
  redFlags: ['Trapped under debris → cover mouth, tap on a pipe or wall, do not shout unless you hear rescuers'],
};

export const flood: Protocol = {
  id: 'flood',
  title: 'Flood / flash flood',
  spokenName: 'flood safety',
  triggers: ['rapidly rising water', 'water over road', 'vehicle in water', 'storm surge'],
  sceneSafety: ['Six inches of moving water can knock you down; one foot can float a car.'],
  callEmergencyOnEntry: false,
  entry: 'where',
  steps: {
    where: {
      id: 'where',
      say: 'Are you in a vehicle, on foot, or in a building?',
      ask: 'Vehicle, on foot, or in a building?',
      branches: [
        { when: 'vehicle', next: 'vehicle' },
        { when: 'on foot', next: 'foot' },
        { when: 'building', next: 'building' },
      ],
    },
    vehicle: {
      id: 'vehicle',
      say: 'Do not drive into water. If water is rising around the car, get out now and climb to higher ground. If it is sweeping the car, get on the roof.',
      ar: { kind: 'arrow_to', target: 'high_ground' },
      escalate: true,
      next: 'call',
    },
    foot: {
      id: 'foot',
      say: 'Move to higher ground immediately, away from the water. Never walk through moving water — use a stick to test depth if you must cross still water.',
      ar: { kind: 'arrow_to', target: 'high_ground' },
      next: 'call',
    },
    building: {
      id: 'building',
      say: 'Move to the highest floor. Do not go into a closed attic — you could be trapped. Bring a phone and something bright to signal with.',
      next: 'call',
    },
    call: {
      id: 'call',
      say: 'Call 911 with your exact location. Avoid downed power lines and anything electrical touching water.',
      ar: { kind: 'highlight', targets: ['hazard'] },
      escalate: true,
      next: null,
    },
  },
  doNot: ['Do not drive or walk through floodwater.', 'Do not touch electrical equipment if wet.', 'Do not go into a closed attic.'],
  redFlags: ['Person swept away → do not enter water; throw something that floats, call 911, keep eyes on them'],
};

export const wildfireSmoke: Protocol = {
  id: 'wildfire_smoke',
  title: 'Wildfire / heavy smoke',
  spokenName: 'wildfire safety',
  triggers: ['orange sky', 'ash falling', 'wall of smoke', 'flames on hillside', 'evacuation sirens'],
  sceneSafety: [],
  callEmergencyOnEntry: false,
  entry: 'order',
  steps: {
    order: {
      id: 'order',
      say: 'If you can see flames or an evacuation order is out, leave now — do not wait. Drive with headlights on, windows up.',
      escalate: true,
      next: 'route',
    },
    route: {
      id: 'route',
      say: 'Head away from the fire and downhill if possible. Avoid canyons. I am checking live road closures for you.',
      ar: { kind: 'arrow_to', target: 'away_from_hazard' },
      next: 'trapped',
    },
    trapped: {
      id: 'trapped',
      say: 'If you get trapped: stay in the car, engine running, lights on, lie on the floor under a blanket. Call 911 with your location.',
      next: null,
    },
  },
  doNot: ['Do not try to outrun a fire uphill.', 'Do not wait for a mandatory order if you feel unsafe.'],
  redFlags: [],
};

export const vehicleCrash: Protocol = {
  id: 'vehicle_crash',
  title: 'Vehicle crash',
  spokenName: 'crash response',
  triggers: ['crumpled vehicle', 'airbags deployed', 'vehicle overturned', 'person in a crashed car'],
  sceneSafety: ['Park well back with hazards on. Watch for traffic — more people are hurt by second collisions than first.', 'Look for leaking fuel, downed wires, fire.'],
  callEmergencyOnEntry: true,
  entry: 'call',
  steps: {
    call: {
      id: 'call',
      say: 'Call 911 with the location, number of vehicles, and whether anyone is trapped. Turn on your hazards.',
      escalate: true,
      next: 'approach',
    },
    approach: {
      id: 'approach',
      say: 'Approach only if there is no fire or fuel smell. Turn off their ignition if you can reach it. Talk to the people inside.',
      ar: { kind: 'highlight', targets: ['hazard'] },
      ask: 'Is anyone unresponsive, not breathing, or bleeding heavily?',
      branches: [
        { when: 'yes', next: 'handoff' },
        { when: 'no', next: 'stabilize' },
      ],
    },
    handoff: {
      id: 'handoff',
      say: 'Tell me who and what you see — I will switch to bleeding control or CPR. Only move them if the car is on fire or in danger.',
      next: null,
    },
    stabilize: {
      id: 'stabilize',
      say: 'Tell them not to move their head or neck. Keep them still and warm, and keep talking to them until help arrives.',
      next: null,
    },
  },
  doNot: ['Do not move an injured person unless there is immediate danger.', 'Do not remove a helmet.', 'Do not stand between vehicles or in a traffic lane.'],
  redFlags: ['Fire or fuel smell → get everyone who can move away, do not approach'],
};

export const downedPowerLine: Protocol = {
  id: 'downed_power_line',
  title: 'Downed power line',
  spokenName: 'electrical hazard',
  triggers: ['wire on the ground', 'sparking line', 'wire on a vehicle', 'pole leaning or snapped'],
  sceneSafety: ['Assume every line is live. Electricity spreads through the ground — stay at least 35 feet, a full bus length, away.'],
  callEmergencyOnEntry: true,
  entry: 'back',
  steps: {
    back: {
      id: 'back',
      say: 'Stop. Shuffle backwards with small steps, feet together — do not lift them. Get at least a bus length away.',
      ar: { kind: 'arrow_to', target: 'away_from_hazard' },
      escalate: true,
      next: 'call',
    },
    call: {
      id: 'call',
      say: 'Call 911 and the power company. Keep everyone away. If a line is on a car, tell the people inside to stay in it.',
      next: null,
    },
  },
  doNot: ['Do not touch anyone or anything in contact with the line.', 'Do not drive over a line.', 'Do not try to move it with a stick.'],
  redFlags: ['Someone touching the line → do NOT touch them; call 911 and wait for power to be cut'],
};

export const generalSceneSafety: Protocol = {
  id: 'general_scene_safety',
  title: 'Unclear emergency',
  spokenName: 'scene check',
  triggers: ['something is wrong but unclear', 'crowd gathering', 'person distressed'],
  sceneSafety: ['Look for danger to you first: traffic, fire, water, wires, aggression.'],
  callEmergencyOnEntry: false,
  entry: 'describe',
  steps: {
    describe: {
      id: 'describe',
      say: 'Tell me what you see. Is anyone hurt, is anything on fire, or is water or debris involved?',
      next: null,
    },
  },
  doNot: [],
  redFlags: [],
};

export const disasterProtocols: Protocol[] = [
  structureFire,
  earthquake,
  flood,
  wildfireSmoke,
  vehicleCrash,
  downedPowerLine,
  generalSceneSafety,
];
