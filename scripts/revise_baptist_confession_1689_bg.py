#!/usr/bin/env python3
"""Apply the reviewed Bulgarian corrections and align proof references with ed1."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BG_IMP = ROOT / "data/sources/BaptistConfession1689_BG.imp"
BG_GZ = ROOT / "data/sources/BaptistConfession1689_BG.imp.gz"
BG_INFO = ROOT / "data/sources/BaptistConfession1689_BG.info.json"
EN_ED1 = ROOT / "data/sources/BaptistConfession1689-ed1.imp.gz"


@dataclass(frozen=True)
class Replacement:
    location: str
    before: str
    after: str
    count: int = 1


REPLACEMENTS = [
    Replacement(
        "title",
        "БАПТИСТКОТО ИЗПОВЕДАНИЕ НА ВЯРАТА ОТ 1689 Г. С ПИСАНИЯ ДОКАЗАТЕЛСТВА",
        "БАПТИСТКА ИЗПОВЕД НА ВЯРАТА ОТ 1689 Г. С ДОКАЗАТЕЛСТВА ОТ ПИСАНИЕТО",
    ),
    Replacement(
        "title",
        "Представено от старейшините и братята",
        "Изложена от старейшините и братята",
    ),
    Replacement(
        "contents",
        "БАПТИСТКОТО ИЗПОВЕДАНИЕ НА ВЯРАТА",
        "БАПТИСТКА ИЗПОВЕД НА ВЯРАТА",
    ),
    Replacement(
        "contents",
        "За Божието определение",
        "За Божието постановление",
    ),
    Replacement(
        "3.title",
        "ЗА БОЖИЯ УКАЗ",
        "ЗА БОЖИЕТО ПОСТАНОВЛЕНИЕ",
    ),
    Replacement(
        "3.1",
        "изпълнението на Неговия указ",
        "изпълнението на Неговото постановление",
    ),
    Replacement(
        "3.3",
        "Чрез Божия указ",
        "Чрез Божието постановление",
    ),
    Replacement(
        "5.title",
        "ЗА БОЖЕСТВЕНОТО ПРОМИСЪЛ",
        "ЗА БОЖИЕТО ПРОВИДЕНИЕ",
    ),
    Replacement(
        "17.contents",
        "За постоянството на светиите",
        "За устояването на светиите",
    ),
    Replacement(
        "22.contents",
        "За религиозното поклонение и съботния ден",
        "За богослужението и съботния ден",
    ),
    Replacement(
        "22.title",
        "ОТНОСНО РЕЛИГИОЗНОТО ПОКЛОНЕНИЕ И СЪБОТНИЯ ДЕН",
        "ЗА БОГОСЛУЖЕНИЕТО И СЪБОТНИЯ ДЕН",
    ),
    Replacement(
        "24.contents",
        "За гражданския магистрат",
        "За гражданската власт",
    ),
    Replacement(
        "27.title",
        "ЗА ОБЩУВАНЕТО НА СВЕТИИТЕ",
        "ЗА ОБЩЕНИЕТО НА СВЕТИИТЕ",
    ),
    Replacement(
        "Content",
        '<reference osisRef="BaptistConfession1689:Foreword">ПРЕДГОВОР</reference></reference>',
        '<reference osisRef="BaptistConfession1689:Foreword">ПРЕДГОВОР</reference>',
    ),
    Replacement(
        "1.2",
        "<item>Галатяни<item>",
        "<item>Галатяни</item>",
    ),
    Replacement(
        "Foreword",
        "този отличен списък от доктрини",
        "това превъзходно изложение на ученията",
    ),
    Replacement(
        "Foreword",
        "неговите водещи доктрини",
        "неговите основни учения",
    ),
    Replacement(
        "Foreword",
        "славните доктрини на Свободната Благодат",
        "славните учения за свободната благодат",
    ),
    Replacement(
        "Foreword",
        "обединен фронт на доктринално съгласие",
        "обединено съгласие във вероучението",
    ),
    Replacement(
        "Foreword",
        "съществено съгласие с тях в доктрината",
        "съществено съгласие с тях в учението",
    ),
    Replacement(
        "1.1",
        "вече са завършени",
        "вече са преустановени",
    ),
    Replacement(
        "1.4",
        "поради който то трябва да бъде вярвано",
        "поради който сме длъжни да му вярваме",
    ),
    Replacement(
        "1.5",
        "небесният характер на материята",
        "небесният характер на съдържанието",
    ),
    Replacement(
        "1.5",
        "ефикасността на учението",
        "действеността на учението",
    ),
    Replacement(
        "1.5",
        "обхватът на цялото",
        "целта на цялото",
    ),
    Replacement(
        "1.5",
        "много други несравними превъзходства, и пълни съвършенства на същото",
        "много други несравними достойнства и пълното му съвършенство",
    ),
    Replacement(
        "1.5",
        "чрез които то изобилно доказва",
        "чрез които то недвусмислено свидетелства",
    ),
    Replacement(
        "1.6",
        "или задължително съдържащо се",
        "или по необходимост съдържащо се",
    ),
    Replacement(
        "1.6",
        "за спасителното разбиране на такива неща",
        "за правилното разбиране на онези неща, водещи към спасение",
    ),
    Replacement(
        "1.8",
        "тези оригинални езици",
        "тези езици на оригинала",
    ),
    Replacement(
        "1.8",
        "който има право и интерес към Писанията",
        "който има право на Писанията и дял в тях",
    ),
    Replacement(
        "1.9",
        "(което не е много, а едно)",
        "(чийто смисъл не е многозначен, а един)",
    ),
    Replacement(
        "1.10",
        "в чиято присъда трябва да почиваме",
        "на чието решение трябва да се доверим",
    ),
    Replacement(
        "1.10",
        "в което така предадено Писание нашата вяра окончателно се разрешава",
        "върху което така предадено Писание в крайна сметка се основава нашата вяра",
    ),
    Replacement(
        "2.3",
        "на нашата утешителна зависимост от Него",
        "на утешителното ни упование в Него",
    ),
    Replacement(
        "3.1",
        "нито се предлага насилие на волята на творението",
        "нито се упражнява насилие над волята на творението",
    ),
    Replacement(
        "3.1",
        "случайността на второстепенните причини",
        "случайността на вторичните причини",
    ),
    Replacement(
        "3.6",
        "са ефективно призовани към вяра",
        "са действено призовани към вяра",
    ),
    Replacement(
        "3.6",
        "или ефективно призован, оправдан",
        "или действено призован, оправдан",
    ),
    Replacement(
        "3.7",
        "със специална благоразумие и грижа",
        "с особено благоразумие и грижа",
    ),
    Replacement(
        "3.7",
        "Доктрината за високата тайна на предопределението",
        "Учението за великата тайна на предопределението",
    ),
    Replacement(
        "3.7",
        "от сигурността на своето ефективно призвание",
        "от сигурността на своето действено призоваване",
    ),
    Replacement(
        "3.7",
        "така тази доктрина ще даде повод",
        "така това учение ще даде повод",
    ),
    Replacement(
        "4.2",
        "но все пак под възможността да престъпят",
        "но все пак с възможност да престъпят",
    ),
    Replacement(
        "4.3",
        "която докато спазваха, бяха щастливи",
        "и докато я спазваха, бяха блажени",
    ),
    Replacement(
        "5.4",
        "не чрез голо позволение",
        "не само чрез допускане",
    ),
    Replacement(
        "5.4",
        "в многообразно разпореждане за Своите най-святи цели",
        "по многообразни начини за Своите пресвяти цели",
    ),
    Replacement(
        "5.5",
        "да ги издигне до по-тясно и постоянно упование на Него за тяхната подкрепа",
        "да ги доведе до по-близко и постоянно упование в Него за своята подкрепа",
    ),
    Replacement(
        "5.6",
        "да бъдат обработени сърцата им",
        "да бъде въздействано върху сърцата им",
    ),
    Replacement(
        "5.6",
        "ги излага на такива обекти",
        "ги излага на такива обстоятелства",
    ),
    Replacement(
        "5.7",
        "така по по-специален начин",
        "така по най-особен начин",
    ),
    Replacement(
        "6.3",
        "произлизащо от тях по обикновено поколение",
        "произлизащо от тях по естествено раждане",
    ),
    Replacement(
        "6.3",
        "духовни, временни и вечни",
        "духовни, земни и вечни",
    ),
    Replacement(
        "6.4",
        "сме напълно неразположени, неспособни и противопоставени на всяко добро",
        "сме напълно несклонни, неспособни и противящи се на всяко добро",
    ),
    Replacement(
        "6.5",
        "са истински и правилно грях",
        "са действително и в собствен смисъл грях",
    ),
    Replacement(
        "7.2",
        "след като човекът се докара под проклятието",
        "след като човекът сам се постави под проклятието",
    ),
    Replacement(
        "8.1",
        "Угодно беше на Бога, в Неговото вечно намерение",
        "Бог благоволи, според Своето вечно намерение",
    ),
    Replacement(
        "8.2",
        "общи немощи",
        "обичайни немощи",
    ),
    Replacement(
        "8.3",
        "да бъде напълно снабден да изпълнява службата",
        "да бъде напълно подготвен да изпълнява служението",
    ),
    Replacement(
        "8.3",
        "вложи цялата власт и съд в Неговата ръка",
        "предаде в ръката Му цялата власт и правото да съди",
    ),
    Replacement(
        "8.5",
        "напълно удовлетвори Божията справедливост",
        "напълно удовлетвори Божията правда",
    ),
    Replacement(
        "8.6",
        "добродетелта, ефикасността и ползата от нея бяха съобщавани",
        "силата, действеността и ползата от нея бяха прилагани",
    ),
    Replacement(
        "8.6",
        "означен като семето, което ще смаже главата на змията",
        "представен като потомството на жената, което ще смаже главата на змията",
    ),
    Replacement(
        "8.8",
        "със сигурност и ефективно прилага и съобщава същото",
        "със сигурност и действено прилага и предава същото",
    ),
    Replacement(
        "8.10",
        "поради нашата отвращение и пълна неспособност",
        "поради нашето нежелание и пълна неспособност",
    ),
    Replacement(
        "9.2",
        "но все пак е бил нестабилен",
        "но все пак е бил изменчив",
    ),
    Replacement(
        "9.3",
        "бидейки напълно отвратен от това добро",
        "бидейки напълно чужд на това добро",
    ),
    Replacement(
        "10.1",
        "давайки им плътско сърце",
        "давайки им сърце от плът",
    ),
    Replacement(
        "10.1",
        "те идват най-свободно, бидейки направени желаещи чрез Неговата благодат",
        "те идват напълно свободно, понеже Неговата благодат събужда у тях желание",
    ),
    Replacement(
        "10.2",
        "нито от някаква сила или действие в творението,<note>",
        "нито от някаква сила или действие в творението, което да съдейства "
        "на Неговата особена благодат;<note>",
    ),
    Replacement(
        "10.2",
        "</note> бидейки напълно пасивен в него, мъртъв в грехове",
        "</note> творението е напълно пасивно в това, бидейки мъртво в грехове",
    ),
    Replacement(
        "11.1",
        "Бог ефективно призовава",
        "Бог действено призовава",
    ),
    Replacement(
        "11.1",
        "за тяхна цялостна и единствена праведност чрез вяра,<note>",
        "за тяхна цялостна и единствена праведност; те приемат Него и Неговата "
        "правда и се уповават на тях чрез вяра;<note>",
    ),
    Replacement(
        "11.3",
        "направи истинско, реално и пълно удовлетворение",
        "принесе действително, истинско и пълно удовлетворение",
    ),
    Replacement(
        "11.5",
        "докато не се смирят, не измолят прошка",
        "докато не се смирят, не изповядат греховете си, не измолят прошка",
    ),
    Replacement(
        "12.1",
        "се наслаждават на свободите и привилегиите",
        "се ползват от свободите и привилегиите",
    ),
    Replacement(
        "12.1",
        "биват съжалявани",
        "биват обгрижвани с бащино състрадание",
    ),
    Replacement(
        "12.1",
        "снабдявани",
        "осигурявани",
    ),
    Replacement(
        "13.1",
        "са съединени с Христос, ефективно призовани",
        "са съединени с Христос, действено призовани",
    ),
    Replacement(
        "13.1",
        "различните му похоти все повече отслабват и умъртвяват",
        "различните му похоти все повече биват отслабвани и умъртвявани",
    ),
    Replacement(
        "13.3",
        "чрез непрекъснатото снабдяване със сила от освещаващия Дух",
        "чрез непрестанната подкрепа на освещаващия Дух",
    ),
    Replacement(
        "14.2",
        "в Неговата природа и служения, и силата и пълнотата на Светия Дух "
        "в Неговите действия и операции",
        "в Неговата природа и служения и силата и пълнотата на Светия Дух "
        "в Неговото действие",
    ),
    Replacement(
        "14.2",
        "истината, в която следователно е повярвал",
        "истината, в която така е повярвал",
    ),
    Replacement(
        "15.1",
        "служили на различни удоволствия",
        "служили на различни страсти и удоволствия",
    ),
    Replacement(
        "15.1",
        "в тяхното ефективно призоваване",
        "при тяхното действено призоваване",
    ),
    Replacement(
        "15.3",
        "човек, бидейки от Светия Дух осъзнат за многобройните злини на своя грях",
        "човек, на когото Светият Дух дава да осъзнае многобройните злини на своя грях",
    ),
    Replacement(
        "15.3",
        "чрез снабдяването от Духа",
        "чрез подкрепата на Духа",
    ),
    Replacement(
        "15.5",
        "Такова е снабдяването, което Бог е направил",
        "Такава е грижата, която Бог е промислил",
    ),
    Replacement(
        "16.3",
        "не е изцяло от самите тях",
        "изобщо не е от самите тях",
    ),
    Replacement(
        "16.3",
        "за да работи в тях и да желае, и да върши според Неговото благоволение",
        "за да действа в тях, та да желаят и да вършат според Неговото благоволение",
    ),
    Replacement(
        "16.3",
        "все пак те не са длъжни да изпълняват каквото и да е задължение, "
        "освен при специално подбуждане от Духа, но трябва",
        "все пак поради това те не бива да стават небрежни, сякаш не са длъжни "
        "да изпълняват никое задължение без специално подбуждане от Духа; напротив, трябва",
    ),
    Replacement(
        "16.5",
        "и понеже те са добри, произлизат от Неговия Дух",
        "и доколкото са добри, те произлизат от Неговия Дух",
    ),
    Replacement(
        "16.5",
        "и понеже са извършени от нас",
        "а доколкото са извършени от нас",
    ),
    Replacement(
        "16.5",
        "строгостта на Божието наказание",
        "строгостта на Божия съд",
    ),
    Replacement(
        "16.6",
        "не като че ли те са били в този живот",
        "не сякаш те са в този живот",
    ),
    Replacement(
        "17.1",
        "ефективно призовал и осветил",
        "действено призовал и осветил",
    ),
    Replacement(
        "17.2",
        "от ефикасността на заслугата и застъпничеството",
        "от действеността на заслугата и застъпничеството",
    ),
    Replacement(
        "19.3",
        "Който беше снабден със сила от Отца за тази цел",
        "Който беше упълномощен от Отца за тази цел",
    ),
    Replacement(
        "19.4",
        "само тяхната обща справедливост е от съвременна употреба",
        "единствено общият принцип на справедливостта в тях има нравствено приложение",
    ),
    Replacement(
        "19.5",
        "обвързва всички, както оправдани лица, така и други, към неговото послушание",
        "задължава всички — както оправданите, така и останалите — да му се покоряват",
    ),
    Replacement(
        "19.7",
        "но сладко се съгласуват с нея",
        "а напълно се съгласуват с нея",
    ),
    Replacement(
        "21.2",
        "свободна от доктрините и заповедите на хора",
        "свободна от човешки учения и заповеди",
    ),
    Replacement(
        "21.2",
        "да вярваш на такива доктрини",
        "да вярваш на такива учения",
    ),
    Replacement(
        "21.2",
        "изискването на сляпа вяра, абсолютно и сляпо послушание",
        "изискването на неосмислена вяра и на безусловно, сляпо послушание",
    ),
    Replacement(
        "22.3",
        "като част от естественото поклонение",
        "като особена част от естественото поклонение",
    ),
    Replacement(
        "23.5",
        "редовно послушание",
        "послушание по монашески устав",
    ),
    Replacement(
        "24.2",
        "длъжността на магистрат",
        "длъжността на граждански управник",
    ),
    Replacement(
        "26.7",
        "според Неговия ум, обявен в Неговото слово",
        "според Неговата воля, разкрита в Неговото слово",
    ),
    Replacement(
        "26.8",
        "за особеното администриране на наредбите",
        "за специалното извършване на наредбите",
    ),
    Replacement(
        "26.13",
        "при каквото и да е взето от него оскърбление",
        "когато по някакъв повод се почувства оскърбен",
    ),
    Replacement(
        "26.13",
        "от администрирането на каквито и да е наредби",
        "от извършването на каквито и да е наредби",
    ),
    Replacement(
        "26.14",
        "на всички Христови църкви, на всички места",
        'на всички Христови църкви<note><reference osisRef="Eph.6.18">Еф. 6:18</reference>; '
        '<reference osisRef="Ps.122.6">Пс. 122:6</reference></note>, на всички места',
    ),
    Replacement(
        "26.14",
        "да могат да се наслаждават на възможност и предимство за това",
        "да имат благоприятна възможност за това",
    ),
    Replacement(
        "26.15",
        "било по отношение на доктрина или администрация",
        "било по отношение на учението или църковното управление",
    ),
    Replacement(
        "26.15",
        "според ума на Христос е",
        "съгласно волята на Христос е",
    ),
    Replacement(
        "27.2",
        "свято общение и общност",
        "свято братство и общение",
    ),
    Replacement(
        "28.1",
        "са наредби на положително и суверенно установяване",
        "са наредби, положително и върховно установени",
    ),
    Replacement(
        "29.2",
        "са единствените подходящи субекти на тази наредба",
        "са единствените, на които подобава да приемат тази наредба",
    ),
    Replacement(
        "29.4",
        "Потапянето, или потапянето на лицето във вода",
        "Потапянето на кръщавания във вода",
    ),
    Replacement(
        "30.1",
        "за вечно възпоменание и показване на целия свят на Неговата жертва в Неговата смърт",
        "за постоянно възпоменаване и възвестяване на жертвата, която Той принесе чрез смъртта Си",
    ),
    Replacement(
        "30.2",
        "духовно приношение на всяка възможна хвала",
        "духовно приношение на възможно най-пълна хвала",
    ),
    Replacement(
        "30.4",
        "са всичко това противни на природата",
        "всичко това е противно на естеството",
    ),
    Replacement(
        "30.6",
        "събаря природата на постановлението",
        "унищожава естеството на постановлението",
    ),
    Replacement(
        "30.8",
        "са неподходящи да се наслаждават на общение с Христос",
        "не са годни да имат общение с Христос",
    ),
    Replacement(
        "32.2",
        "с вечни награди",
        "с вечна награда",
    ),
    Replacement(
        "32.3",
        "че ще има съден ден",
        "че ще има ден на съд",
    ),
    Replacement(
        "End",
        "съдържаща доктрината на нашата вяра и практика",
        "съдържаща учението на нашата вяра и практика",
    ),
]


REFERENCE_LOCATIONS = [
    "1.5",
    "3.1",
    "3.3",
    "3.5",
    "3.6",
    "4.2",
    "4.3",
    "5.1",
    "5.4",
    "5.5",
    "5.6",
    "7.3",
    "8.2",
    "8.3",
    "8.4",
    "8.9",
    "11.5",
    "14.2",
    "16.3",
    "16.5",
    "16.6",
    "20.2",
    "21.1",
    "22.5",
    "22.8",
    "23.5",
    "26.3",
    "26.14",
    "30.6",
    "31.1",
    "32.1",
]


BOOK_NAMES = {
    "Acts": "Деян.",
    "Amos": "Ам.",
    "Col": "Кол.",
    "Dan": "Дан.",
    "Deut": "Вт.",
    "Eccl": "Екл.",
    "Eph": "Еф.",
    "Esth": "Ест.",
    "Exod": "Изх.",
    "Ezek": "Езек.",
    "Gal": "Гал.",
    "Gen": "Бит.",
    "Hab": "Авак.",
    "Hag": "Агей",
    "Heb": "Евр.",
    "Hos": "Ос.",
    "Isa": "Ис.",
    "Jas": "Як.",
    "Jer": "Ер.",
    "Job": "Йов",
    "Joel": "Йоил",
    "John": "Йоан",
    "Jonah": "Йона",
    "Josh": "Ис. Нав.",
    "Jude": "Юда",
    "Lam": "Плач",
    "Lev": "Лев.",
    "Luke": "Лука",
    "Mal": "Мал.",
    "Mark": "Марк",
    "Matt": "Мат.",
    "Mic": "Мих.",
    "Nah": "Наум",
    "Neh": "Неем.",
    "Num": "Чис.",
    "Obad": "Авд.",
    "Phil": "Фил.",
    "Phlm": "Филим.",
    "Prov": "Пр.",
    "Ps": "Пс.",
    "Rev": "Откр.",
    "Rom": "Рим.",
    "Ruth": "Рут",
    "Song": "Пес.",
    "Zech": "Зах.",
    "Zeph": "Соф.",
    "Titus": "Тит",
    "1Chr": "1 Лет.",
    "1Cor": "1 Кор.",
    "1John": "1 Йоан",
    "1Kgs": "3 Цар.",
    "1Pet": "1 Пет.",
    "1Sam": "1 Цар.",
    "1Thess": "1 Сол.",
    "1Tim": "1 Тим.",
    "2Chr": "2 Лет.",
    "2Cor": "2 Кор.",
    "2John": "2 Йоан",
    "2Kgs": "4 Цар.",
    "2Pet": "2 Пет.",
    "2Sam": "2 Цар.",
    "2Thess": "2 Сол.",
    "2Tim": "2 Тим.",
    "3John": "3 Йоан",
}


def apply_replacement(text: str, change: Replacement) -> tuple[str, bool]:
    found = text.count(change.before)
    if found == change.count:
        return text.replace(change.before, change.after, change.count), True
    if found == 0 and text.count(change.after) >= change.count:
        return text, False
    raise ValueError(
        f"{change.location}: expected {change.count} occurrence(s), found {found}: "
        f"{change.before!r}"
    )


def parse_entries(text: str) -> dict[str, str]:
    entries: dict[str, str] = {}
    for match in re.finditer(
        r"^\$\$\$(/[^\n]+)\n(.*?)(?=^\$\$\$/|\Z)",
        text,
        flags=re.DOTALL | re.MULTILINE,
    ):
        entries[match.group(1)] = match.group(2)
    return entries


def paragraph(body: str, number: int, language: str) -> str:
    label = "Paragraph" if language == "en" else "Параграф"
    match = re.search(
        rf"(<p><title>{label} {number}</title>.*?)(?=<p><title>{label} \d+</title>|\Z)",
        body,
        flags=re.DOTALL,
    )
    if match is None:
        raise ValueError(f"Missing {language} paragraph {number}")
    return match.group(1)


def osis_label(osis_ref: str) -> str:
    match = re.fullmatch(
        r"([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)"
        r"(?:-([1-3]?[A-Za-z]+)\.(\d+)\.(\d+))?",
        osis_ref,
    )
    if match is None:
        raise ValueError(f"Unsupported OSIS reference: {osis_ref}")
    start_book, start_chapter, start_verse, end_book, end_chapter, end_verse = (
        match.groups()
    )
    label = f"{BOOK_NAMES[start_book]} {start_chapter}:{start_verse}"
    if end_book is None:
        return label
    if end_book == start_book and end_chapter == start_chapter:
        return f"{label}–{end_verse}"
    if end_book == start_book:
        return f"{label}–{end_chapter}:{end_verse}"
    return f"{label}–{BOOK_NAMES[end_book]} {end_chapter}:{end_verse}"


def render_note(note: str) -> str:
    references = re.findall(r'<reference osisRef="([^"]+)">.*?</reference>', note)
    if not references:
        return note
    rendered = "; ".join(
        f'<reference osisRef="{osis_ref}">{osis_label(osis_ref)}</reference>'
        for osis_ref in references
    )
    return f"<note>{rendered}</note>"


def align_references(text: str, english: str) -> tuple[str, int]:
    en_entries = parse_entries(english)
    changed = 0
    for location in REFERENCE_LOCATIONS:
        chapter_number, paragraph_number = map(int, location.split("."))
        chapter_key = f"/Chapter {chapter_number}"
        section_match = re.search(
            rf"(^\$\$\${re.escape(chapter_key)}\n)(.*?)(?=^\$\$\$/|\Z)",
            text,
            flags=re.DOTALL | re.MULTILINE,
        )
        if section_match is None:
            raise ValueError(f"Missing Bulgarian chapter {chapter_number}")
        bg_body = section_match.group(2)
        bg_paragraph = paragraph(bg_body, paragraph_number, "bg")
        en_paragraph = paragraph(
            en_entries[chapter_key],
            paragraph_number,
            "en",
        )
        en_refs = re.findall(r'<reference osisRef="([^"]+)"', en_paragraph)
        bg_refs = re.findall(r'<reference osisRef="([^"]+)"', bg_paragraph)
        if en_refs == bg_refs:
            continue
        en_notes = re.findall(r"<note>.*?</note>", en_paragraph, flags=re.DOTALL)
        bg_notes = re.findall(r"<note>.*?</note>", bg_paragraph, flags=re.DOTALL)
        if len(en_notes) != len(bg_notes):
            raise ValueError(
                f"{location}: note count differs after preparation: "
                f"{len(en_notes)} != {len(bg_notes)}"
            )
        note_index = 0

        def replace_note(
            _: re.Match[str],
            source_notes: list[str] = en_notes,
        ) -> str:
            nonlocal note_index
            rendered = render_note(source_notes[note_index])
            note_index += 1
            return rendered

        revised_paragraph = re.sub(
            r"<note>.*?</note>",
            replace_note,
            bg_paragraph,
            flags=re.DOTALL,
        )
        revised_body = bg_body.replace(bg_paragraph, revised_paragraph, 1)
        text = (
            text[: section_match.start(2)] + revised_body + text[section_match.end(2) :]
        )
        changed += 1
    return text, changed


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify the committed IMP, gzip, and SWORD package without rewriting them",
    )
    args = parser.parse_args()

    text = BG_IMP.read_text(encoding="utf-8")
    english = gzip.decompress(EN_ED1.read_bytes()).decode("utf-8")
    if text.startswith("$$$\n$$$/$$$\n"):
        text = "$$$\n" + text.removeprefix("$$$\n$$$/$$$\n")

    applied = 0
    for replacement in REPLACEMENTS:
        text, was_applied = apply_replacement(text, replacement)
        applied += int(was_applied)

    text, aligned = align_references(text, english)
    if not text.endswith("\n"):
        text += "\n"
    payload = text.encode("utf-8")
    compressed = gzip.compress(payload, compresslevel=9, mtime=0)

    if args.check:
        info = json.loads(BG_INFO.read_text(encoding="utf-8"))
        package_path = ROOT / info["sword_module"]["package"]
        committed_imp = BG_IMP.read_bytes()
        committed_gzip = BG_GZ.read_bytes()
        checks = {
            "IMP": (
                sha256(committed_imp),
                info["translation"]["decompressed_sha256"],
            ),
            "gzip": (
                sha256(committed_gzip),
                info["translation"]["compressed_sha256"],
            ),
            "SWORD package": (
                sha256(package_path.read_bytes()),
                info["sword_module"]["package_sha256"],
            ),
        }
        mismatches = [
            f"{name}: got {actual}, expected {expected}"
            for name, (actual, expected) in checks.items()
            if actual != expected
        ]
        if committed_imp != payload:
            mismatches.append("IMP: committed source still needs revision")
        if committed_gzip != compressed:
            mismatches.append(
                "gzip: committed archive is not the deterministic IMP gzip"
            )
        if mismatches:
            raise SystemExit(
                "Bulgarian source verification failed:\n" + "\n".join(mismatches)
            )
        print(
            "verified Bulgarian 1689 source and SWORD package "
            f"(imp_sha256={checks['IMP'][0]}, package_sha256={checks['SWORD package'][0]})"
        )
        return

    BG_IMP.write_bytes(payload)
    BG_GZ.write_bytes(compressed)
    print(
        f"Bulgarian revision complete: {applied} text/markup replacements applied; "
        f"{aligned} proof-reference groups aligned."
    )


if __name__ == "__main__":
    main()
