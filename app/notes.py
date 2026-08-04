"""Conversões entre frequência, MIDI e nomes de nota."""

from __future__ import annotations

import math

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
NOTE_NAMES_PT = ["Dó", "Dó#", "Ré", "Ré#", "Mi", "Fá", "Fá#", "Sol", "Sol#", "Lá", "Lá#", "Si"]


def hz_to_midi(hz: float) -> float:
    return 69.0 + 12.0 * math.log2(hz / 440.0)


def midi_to_hz(midi: float) -> float:
    return 440.0 * (2.0 ** ((midi - 69.0) / 12.0))


def midi_to_name(midi: float) -> str:
    """C4 = 60, notação científica (mesma do Melodyne/Logic)."""
    m = int(round(midi))
    return f"{NOTE_NAMES[m % 12]}{m // 12 - 1}"


def midi_to_name_pt(midi: float) -> str:
    m = int(round(midi))
    return f"{NOTE_NAMES_PT[m % 12]}{m // 12 - 1}"


def name_to_midi(name: str) -> int:
    """Aceita 'C4', 'c#3', 'Db4', 'Dó4'."""
    raw = name.strip().replace("♯", "#").replace("♭", "b")
    for i, pt in enumerate(NOTE_NAMES_PT):
        if raw.lower().startswith(pt.lower()):
            octave = int(raw[len(pt):])
            return (octave + 1) * 12 + i
    letters = "C_D_EF_G_A_B"
    idx = letters.index(raw[0].upper())
    pos = 1
    if pos < len(raw) and raw[pos] in "#b":
        idx += 1 if raw[pos] == "#" else -1
        pos += 1
    octave = int(raw[pos:])
    return (octave + 1) * 12 + idx


def interval_name(semitones: int) -> str:
    names = [
        "uníssono", "2ª menor", "2ª maior", "3ª menor", "3ª maior", "4ª justa",
        "trítono", "5ª justa", "6ª menor", "6ª maior", "7ª menor", "7ª maior",
    ]
    octaves, rest = divmod(abs(semitones), 12)
    base = names[rest]
    if octaves and rest:
        return f"{octaves} oitava(s) + {base}"
    if octaves:
        return f"{octaves} oitava(s)"
    return base
