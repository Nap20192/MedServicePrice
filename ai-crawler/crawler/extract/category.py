"""Classify a medical service into a coarse category.

Categories (Russian, as surfaced in output metadata):
    лаборатория  — lab tests / analyses
    диагностика  — imaging & functional diagnostics (УЗИ, МРТ, КТ, рентген, ЭКГ…)
    процедура    — manipulations, injections, surgery, physio
    приём врача   — doctor consultation / appointment
    прочее       — could not classify

Signal cascade: the service *name* decides first (most specific); the *URL path*
is the fallback (e.g. a doctor's full name on /napravleniya/ginekologiya → приём
врача). Diagnostics is checked before laboratory because an "УЗI органов" is an
imaging study, not a lab analysis.
"""
from __future__ import annotations

import re
from urllib.parse import urlparse

LAB = "лаборатория"
DIAG = "диагностика"
PROC = "процедура"
VISIT = "приём врача"
OTHER = "прочее"

_DIAG = ("узи", "uzi", "мрт", "mrt", "мскт", "рентген", "ренген", "rentgen", "эхокг",
         "эхо-кг", "экг", "ээг", "эхг", "допплер", "doppler", "дуплекс", "сканир",
         "томограф", "diagnost", "radiology", "luchevaya", "funkcionaln", "endoskop",
         "гастроскоп", "колоноскоп", "флюорограф", "маммограф", "денситометр", "фгдс",
         "фкс", "эластограф", "холтер", "спирометр", "аудиометр")
_DIAG_WORDS = re.compile(r"\b(кт|мрт|мскт|узи|экг|ээг|фгдс|фкс|кещ)\b", re.IGNORECASE)
_LAB = ("анализ", "analiz", "laborator", "лаборатор", "кровь", "моча", "соэ", "оак",
        "биохим", "гормон", "серолог", "пцр", "pcr", "иммуноглоб", "цитолог", "гистолог",
        "мазок", "соскоб", "посев", "антител", "коагулог", "ферритин", "гликирован",
        "маркер", "профиль", "чекап", "checkup", "витамин")
_PROC = ("процедур", "манипул", "инъекц", "укол", "капельниц", "массаж", "перевязк",
         "операц", "аборт", "удаление", "удален", "биопси", "пункц", "анестез", "наркоз",
         "физиотерап", "прижиган", "склеротерап", "склероз", "привив", "вакцин", "инфузи",
         "промывани", "дренаж", "дренир", "блокада", "тампонад", "бужирован",
         "вскрыт", "иссеч", "резекц", "пластик", "ушиван", "наложение шв", "снятие шв",
         "косметический шов", "пхо ", "ампутац", "коагул", "криодеструк", "лазерн")
_VISIT = ("приём", "прием", "консультац", "priem", "priyom", "konsultac", "consultation",
          "осмотр", "врач", "vrach", "doctor", "доктор", "специалист", "napravleni",
          "консультация")


def _hit(text: str, words: tuple[str, ...]) -> bool:
    return any(w in text for w in words)


def categorize(name: str = "", url: str = "") -> str:
    n = (name or "").lower()
    if _hit(n, _DIAG) or _DIAG_WORDS.search(n):
        return DIAG
    if _hit(n, _LAB):
        return LAB
    if _hit(n, _PROC):
        return PROC
    if _hit(n, _VISIT):
        return VISIT

    path = urlparse(url).path.lower()
    if _hit(path, _DIAG):
        return DIAG
    if _hit(path, _LAB):
        return LAB
    if _hit(path, _VISIT):
        return VISIT
    if _hit(path, _PROC):
        return PROC
    return OTHER
