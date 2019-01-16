'use strict';

requirejs.config({
    baseUrl: 'js/vendor',
    paths: {
        jquery: 'jquery-2.1.3.min',
        moment: 'moment',
        vuejs: 'vue.min',
        fullcalendar: 'fullcalendar',
        ics: 'ics.js?v=Cheizoo7',
        FileSaver: 'FileSaver.min',
        html2canvas: 'html2canvas.min.js?v=Cheizoo7',
        jszip: 'jszip.min',
    }
});

require(["vuejs", "jquery", "moment", "fullcalendar", "ics", "FileSaver", "html2canvas", "jszip"], function() {

    var Vue = require("vuejs");
    var moment = require("moment");
    var $ = require("jquery");
    var ics = require("ics"); // https://github.com/nwcell/ics.js
    var html2canvas = require("html2canvas");
    var JSZip = require("jszip");

    // FIXME: seperate module.
    var colors = ["#1abc9c", "#2ecc71", "#3498db", "#f1c40f", "#e67e22", "#e74c3c", "#16a085", "#27ae60", "#2980b9", "#f39c12", "#d35400", "#c0392b"];

    // http://www.hkcc-polyu.edu.hk/students/Academic_calendar/Academic_Calendar_2017_18.pdf
    var calEvents = {
    };


    var Course = function(subjectCode, subjectTitle, group, color) {
        this.subjectCode = subjectCode;
        this.subjectTitle = subjectTitle;
        this.group = group;
        this.color = color;
    }

    var Lesson = function(course, activity, day, startTime, endTime, venue, startWeek, endWeek, forEvery) {
        // input dayString:"Mon", weekInfoString:"1 (23-Jan)", output moment
        function parseWeekInfoString(dayString, weekInfoString) {
            dayString = dayString.trim();
            var regexp = /\((\d+\-\w+)\)/g;
            var regexResult = regexp.exec(weekInfoString);

            if (!regexResult)
                throw new Error("Cannot parse weekInfoString: " + weekInfoString);

            var momentObj = moment(regexResult[1], "DD-MMM");

            if (!momentObj.isValid()) {
                throw new Error("Cannot parse weekInfoString: " + regexResult[1]);
            }

            var expectedDayObject = moment().day(dayString);

            if (!expectedDayObject.isValid()) {
                throw new Error("Cannot parse dayString: " + dayString);
            }

            var expectedDay = moment().day(dayString).day();

            if (momentObj.day() == expectedDay) {
                return momentObj;
            }
            console.warn("Inconsistency between dayString and weekInfoString.", {
                dayString: dayString,
                weekInfoString: weekInfoString
            });

            // find the year with the specificed weekday
            for (var i = -1; i <= 1; i++) {
                if (i == 0) continue;

                if (momentObj.clone().add(i, 'year').day() !== expectedDay) {
                    continue;
                }

                momentObj.add(i, 'year');
                console.log("Inconsistency resolved. The weekInfoString will be considered as ", momentObj.format());
                return momentObj;
            }

            throw new Error("Cannot resolve the inconsistency (" + dayString + " is not " + regexResult[1] + " [" + expectedDay + "])");
        }

        function parseTimeString(dateTime, timeString) {
            var o = moment(timeString, "hh:mm");
            if (!o.isValid()) {
                throw new Error("Cannot parseTimeString: " + timeString);
            }
            return moment(dateTime).set({
                "hour": o.hour(),
                "minute": o.minute()
            });
        }

        function parseActvPerWeekInfoString(actvPerWeekInfoString) {
            actvPerWeekInfoString = actvPerWeekInfoString.replace(/wk\(s\)/g, "week");

            var regexp = /(\d+) (.+)/g;
            var regexResult = regexp.exec(actvPerWeekInfoString);
            if (!regexResult)
                throw new Error("Cannot parse actvPerWeekInfoString: " + actvPerWeekInfoString);
            return {
                amount: regexResult[1],
                unit: regexResult[2]
            };
        }

        this.course = course;
        this.activity = activity;
        this.activityShort = activity.match(/[A-Z]/g).join('');
        this.day = day;
        this.startTime = startTime;
        this.endTime = endTime;
        this.venue = venue;
        this.startWeek = startWeek;
        this.endWeek = endWeek;
        this.forEvery = forEvery;

        this.getStartWeekMonent = function() {
            return parseWeekInfoString(this.day, this.startWeek);
        };
        this.getEndWeekMonent = function() {
            var m = parseWeekInfoString(this.day, this.endWeek);
            if (m.isBefore(this.getStartWeekMonent())) {
                throw new Error("end week is before start week.");
            }
            return m;
        };
        this.getStartTimeMonent = function(dt) {
            return parseTimeString(dt, this.startTime);
        };
        this.getEndTimeMonent = function(dt) {
            return parseTimeString(dt, this.endTime);
        };
        this.getForEvery = function() {
            try {
                return parseActvPerWeekInfoString(this.forEvery);
            }
            catch (e) {
                if (this.forEvery === 'wk(s)') { // SPEED, why missing the '1'
                    return {
                        amount: 1,
                        unit: 'week'
                    };
                }
                throw e;
            }
        };
        this.getMonents = function() {
            var monents = [];
            var startDate = this.getStartWeekMonent();
            var endDate = this.getEndWeekMonent();

            var forEvery = this.getForEvery();

            while (startDate.isSameOrBefore(endDate)) {
                var currentEventStart = this.getStartTimeMonent(startDate);
                var currentEventEnd = this.getEndTimeMonent(startDate);
                monents.push({
                    'start': currentEventStart,
                    'end': currentEventEnd
                });

                startDate = startDate.add(forEvery.amount, forEvery.unit);
            }
            return monents;

        };
        this.clone = function() {
            return new Lesson(course, activity, day, startTime, endTime, venue, startWeek, endWeek, forEvery);
        };
    }

    // hex: "#123456"
    function colorBrightness(hex) {
        var r = 0.2126 * parseInt(hex.substr(1, 2), 16); //Converting to rgb and multiplying luminance
        var g = 0.7152 * parseInt(hex.substr(3, 2), 16);
        var b = 0.0722 * parseInt(hex.substr(5, 2), 16);

        return r + g + b;
    }

    var app = new Vue({
        el: '#app',
        data: {
            activeStep: 0,
            lessons: [],
            courses: [],
            app: {
                name: "HKCC TAG v0.0.0",
                domain: "tag.hkcc.space"
            },
            calData: {
                firstDay: undefined,
                lastDay: undefined,
                firstLesson: undefined,
                lastLesson: undefined,
                startTime: 8 * 60 + 0, // 08:00
                endTime: 19 * 60 + 0, // 19:00
                weekdays: [false, false, false, false, false, false, false],
            },
            calEvents: {
                week: [],
                holiday: [],
                school: [],
                lesson: [],
                lessonIcs: [], // lessonIcs for ics generation
            },
            calColors: {
                textColorBright: "#fff",
                textColorDark: "#000",
                week: "#ecf0f1",
                school: "#34495e",
                holiday: "#c0392b",
            },
            calOptions: {
                week: true,
                holiday: true,
                school: true,
                lesson: true,
                forceShowSunSat: false,
            },
            template: {
                title: "{subjectCode} {subjectTitle} {activity}",
                description: "",
                venue: "{venue}",
            },
            pasteError: false,
            pastedData: "",
            imageRendering: false,
            imageRenderingNumber: 0,
            imageRenderingProcess: "",
            showAdvanceOptionPanel: false,
            showEventHolidayList: false,
            fatalError: {
                occurred: false,
                log: "",
            }
        },
        computed: {
            unsupportedBrowser: function() {
                if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i.test(navigator.vendor)) {
                  return false; // mobile are not supported
                }
                var isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
                var isFirefox = typeof InstallTrigger !== 'undefined';
                return !(isChrome || isFirefox); // if not chrome or firefox, unsupported
            }
        },
        watch: {
            activeStep: function(val) {
                window.scrollTo(0, 0);
                history.pushState(null, null, '#step' + val);
                if (ga) // gather some usage data
                    ga('send', 'pageview', {
                    'page': location.pathname + location.search + location.hash
                });
            }
        },
        mounted: function() { // on page ready
            var app = this;
            window.onerror = function (message, source, lineno, colno, errObj) {
                app.fatalError.occurred = true;
                app.fatalError.log += JSON.stringify({
                    message: message, 
                    source: source, 
                    lineno: lineno, 
                    colno: colno, 
                    errObj: JSON.stringify(errObj),
                    browser: navigator.userAgent
                }) + "\n";
            }

            $('#calendar').fullCalendar({
                header: {
                    left: 'prev,next today',
                    center: 'title',
                    right: 'month,agendaWeek'
                },
                defaultView: 'agendaWeek',
                contentHeight: 'auto',
                editable: false,
                columnFormat: 'ddd D/M',
                eventRender: function(event, element) {
                    if (event.allDay)
                        return;

                    var span = $("<span>");
                    span.css('background-color', event.backgroundColor);
                    span.html(
                        "<b>" + event.start.format("HH:mm") + "-" + event.end.format("HH:mm") + "</b><br>" +
                        event.title + "<br>" +
                        event.venue
                    );

                    element.html(span);
                }
            });

            this.generateSchoolEvents();
            this.generateHolidays();
            this.activeStep = 1;
        },
        methods: {
            onError: function(e) {
                console.log("onerror", e);
            },
            onPaste: function(e) {
                if (this.activeStep != 1)
                    return;

                e.stopPropagation();
                e.preventDefault();

                this.courses = [];
                this.lessons = [];

                var clipboardData = e.clipboardData || window.clipboardData;

                this.pastedData = clipboardData.getData('Text');
                var timetableText = this.pastedData.replace(/\r/g, '').split('\n');

                // "CCN1046 ENGLISH FOR ACADEMIC STUDIES (SCIENCE AND TECHNOLOGY) I 127 Lecture Mon 08:30   10:25   Hung Hom Bay    108 1 (04-Sep)  13 (27-Nov) 1 wk(s)"
                var typeOneRegex = /^([^\t]+?)\t([^\t]+?)\t([^\t]+?)\t([^\t]+?)\t([^\t]+?)\t([^\t]+?)\t([^\t]+?)\t([^\t]+?)\t([^\t]+?)\t([^\t]+?)\t([^\t]+?)$/;

                // typeTwo record are the record without subjectcode etc
                // "Tutorial    Thu 14:30   15:25   Hung Hom Bay    602 1 (07-Sep)  2 (14-Sep)  1 wk(s)"
                var typeTwoRegex = /^([^\t]+?)\t([^\t]+?)\t([^\t]+?)\t([^\t]+?)\t([^\t]+?)\t([^\t]+?)\t([^\t]+?)\t([^\t]+?)$/;

                var current;
                var colorIndex = 0;

                for (var i in timetableText) {
                    var line = timetableText[i];

                    var typeOne = typeOneRegex.exec(line);
                    var typeTwo = typeTwoRegex.exec(line);

                    if (typeTwo && !current) {
                        throw new Error("Unexpected type two record before type one");
                    }

                    if (typeOne) {
                        if (typeOne[1].match(/Subject Code/g)) // skip heading
                            continue;
                        var c = new Course(typeOne[1], typeOne[2], typeOne[3], colors[colorIndex]);
                        var l = new Lesson(c, typeOne[4], typeOne[5],
                            typeOne[6], typeOne[7], typeOne[8], typeOne[9], typeOne[10],
                            typeOne[11]);

                        this.courses.push(c);
                        this.lessons.push(l);
                        current = l;

                        // color
                        colorIndex++;
                        if (colorIndex >= colors.length) {
                            colorIndex = 0;
                        }

                        continue;
                    }

                    if (typeTwo) {
                        var l = current.clone();
                        l.activity = typeTwo[1];
                        l.day = typeTwo[2];
                        l.startTime = typeTwo[3];
                        l.endTime = typeTwo[4];
                        l.venue = typeTwo[5];
                        l.startWeek = typeTwo[6];
                        l.endWeek = typeTwo[7];
                        l.forEvery = typeTwo[8];

                        this.lessons.push(l);
                        continue;
                    }
                }

                if (this.lessons.length > 0) {
                    this.activeStep++;
                } else {
                    this.pasteError = true;
                }
            },
            parseTemplateString: function(lesson, str) {
                function replaceAll(target, search, replacement) {
                    return target.replace(new RegExp(search, 'g'), replacement);
                }

                for (var i in lesson) {
                    var v = lesson[i];
                    if (v instanceof Object) {
                        for (var j in lesson[i]) {
                            var v = lesson[i][j];
                            if (typeof v === "string")
                                str = replaceAll(str, "{" + j + "}", v);
                        }
                    }
                    if (typeof v === "string")
                        str = replaceAll(str, "{" + i + "}", v);
                }

                return str;
            },
            getApplicableEvents: function(ics) {
                var applicableEvents = [];

                if (this.calOptions.week) {
                    applicableEvents.push(this.calEvents.week);
                }
                if (this.calOptions.holiday) {
                    applicableEvents.push(this.calEvents.holiday);
                }
                if (this.calOptions.school) {
                    applicableEvents.push(this.calEvents.school);
                }
                if (this.calOptions.lesson) {
                    if (ics)
                        applicableEvents.push(this.calEvents.lessonIcs);
                    else
                        applicableEvents.push(this.calEvents.lesson);
                }

                return applicableEvents;
            },
            generateAllData: function() {
                this.generateSchoolEvents(); // regen for color change
                this.generateHolidays(); // regen for color change

                this.generateLessonEvents(); // depends on holiday events

                this.generateCalendarData();
                this.generateWeekEvents(); // depends on calendar data (firstLesson, lastLesson)
            },
            generateLessonEvents: function() {
                this.calEvents.lesson = [];
                this.calEvents.lessonIcs = [];

                for (var i in this.lessons) {
                    var lesson = this.lessons[i];
                    var lessonMonents = lesson.getMonents();

                    var lessonIcsEvent = undefined;

                    if (lesson.venue === "Cancelled") {
                        console.log("Cancelled ", lesson);
                        continue;
                    }

                    for (var j in lessonMonents) {
                        var startEndMonents = lessonMonents[j];


                        if (!lessonIcsEvent) {
                            var lastDay = lessonMonents[lessonMonents.length - 1]
                                .end.clone().startOf('day');

                            lessonIcsEvent = {
                                title: this.parseTemplateString(lesson, this.template.title),
                                description: this.parseTemplateString(lesson, this.template.description),
                                venue: this.parseTemplateString(lesson, this.template.venue),
                                start: startEndMonents.start,
                                end: startEndMonents.end,
                                allDay: false,
                                recursiveOpts: {
                                    frequency: "WEEKLY",
                                    until: lastDay.clone().endOf('day'),
                                    interval: 1,
                                    byDay: [startEndMonents.start.format("dddd")],
                                    except: []
                                }
                            };
                        }

                        // assume a lesson will only start and end on the same day
                        if (this.isHoliday(startEndMonents.start)) {
                            lessonIcsEvent.recursiveOpts.except.push(startEndMonents.start);
                            continue;
                        }

                        this.calEvents.lesson.push({
                            id: i,
                            title: this.parseTemplateString(lesson, this.template.title),
                            description: this.parseTemplateString(lesson, this.template.description),
                            venue: this.parseTemplateString(lesson, this.template.venue),
                            start: startEndMonents.start,
                            end: startEndMonents.end,
                            backgroundColor: lesson.course.color,
                            textColor: (colorBrightness(lesson.course.color) > 127 ?
                                this.calColors.textColorDark : this.calColors.textColorBright)
                        });
                    }

                    this.calEvents.lessonIcs.push(lessonIcsEvent);
                }
            },
            generateWeekEvents: function() {
                this.calEvents.week = [];

                var weekNumber = 1;
                var m = this.calData.firstLesson.clone().startOf('isoweek');
                while (m.isSameOrBefore(this.calData.lastLesson)) {
                    this.calEvents.week.push({
                        title: "Week " + weekNumber,
                        start: m.clone(),
                        end: m.clone().add(1, 'day'),
                        allDay: true,
                        backgroundColor: this.calColors.week,
                        textColor: (colorBrightness(this.calColors.week) > 127 ?
                            this.calColors.textColorDark : this.calColors.textColorBright)
                    });
                    m.add(1, 'week');
                    weekNumber++;
                }

                return;
            },
            generateSchoolEvents: function() {
                this.calEvents.school = [];

                for (var i in calEvents.school) {
                    var e = calEvents.school[i];

                    this.calEvents.school.push({
                        title: e.title,
                        start: moment(e.start),
                        end: (e.end ? moment(e.end).add(1, 'day') : moment(e.start).add(1, 'day')), // the 'end' is the end time, but not end day. add 1 day for the offset
                        allDay: true,
                        backgroundColor: this.calColors.school,
                        textColor: (colorBrightness(this.calColors.school) > 127 ?
                            this.calColors.textColorDark : this.calColors.textColorBright)
                    });

                }

                return this.calEvents.school;
            },
            generateHolidays: function() {
                this.calEvents.holiday = [];

                for (var i in calEvents.holiday) {
                    var e = calEvents.holiday[i];

                    this.calEvents.holiday.push({
                        title: e.title,
                        start: moment(e.start),
                        end: (e.end ? moment(e.end).add(1, 'day') : moment(e.start).add(1, 'day')),
                        allDay: true,
                        backgroundColor: this.calColors.holiday,
                        textColor: (colorBrightness(this.calColors.holiday) > 127 ?
                            this.calColors.textColorDark : this.calColors.textColorBright)
                    });

                }

                return;
            },
            isHoliday: function(time) {
                for (var i = 0; i < this.calEvents.holiday.length; i++) {
                    var holiday = this.calEvents.holiday[i];
                    if (time.isBetween(holiday.start, holiday.end)) {
                        return true;
                    }
                }
                return false;
            },
            generateCalendarData: function() {
                for (var i = 0; i < this.lessons.length; i++) {
                    var l = this.lessons[i];
                    var start = l.getStartTimeMonent(l.getStartWeekMonent());
                    var end = l.getEndTimeMonent(l.getEndWeekMonent());

                    var startTime = start.hour() * 60 + start.minutes();
                    var endTime = end.hour() * 60 + end.minutes();

                    if (this.calData.startTime > startTime)
                        this.calData.startTime = startTime;

                    if (this.calData.endTime < endTime)
                        this.calData.endTime = endTime;

                    if (!this.calData.firstLesson || start.isSameOrBefore(this.calData.firstLesson)) {
                        this.calData.firstLesson = start;
                    }
                    if (!this.calData.lastLesson || end.isSameOrAfter(this.calData.lastLesson)) {
                        this.calData.lastLesson = end;
                    }

                    this.calData.weekdays[start.weekday()] = true;

                }

                var applicableEvents = this.getApplicableEvents();
                for (var i = 0; i < applicableEvents.length; i++) {
                    var eventArray = applicableEvents[i];

                    if (!eventArray) // week events not available now
                        continue;

                    for (var j = 0; j < eventArray.length; j++) {
                        var event = eventArray[j];
                        if (!this.calData.firstDay || event.start.isSameOrBefore(this.calData.firstDay)) {
                            this.calData.firstDay = event.start;
                        }
                        if (!this.calData.lastDay || event.end.isSameOrAfter(this.calData.lastDay)) {
                            this.calData.lastDay = event.end;
                        }

                    }
                }
            },
            render: function() {
                this.generateAllData();

                $('#calendar').fullCalendar('removeEventSources');

                var applicableEvents = this.getApplicableEvents();
                for (var i = 0; i < applicableEvents.length; i++) {
                    $('#calendar').fullCalendar('addEventSource', applicableEvents[i]);
                }

                $('#calendar').fullCalendar('gotoDate', this.calData.firstLesson);
                $('#calendar').fullCalendar('option', 'validRange', {
                    start: this.calData.firstDay.clone().startOf('month').startOf('week'),
                    end: this.calData.lastDay.clone().endOf('month').endOf('week')
                });

                var minTime = Math.floor(this.calData.startTime / 60) + ":" +
                    this.calData.startTime % 60;
                var maxTime = Math.floor(this.calData.endTime / 60) + ":" +
                    this.calData.endTime % 60;

                var hiddenDays = [];

                if (!this.calOptions.forceShowSunSat) {
                    if (this.calData.weekdays[0] === false)
                        hiddenDays.push(0);
                    if (this.calData.weekdays[6] === false)
                        hiddenDays.push(6);
                }

                $('#calendar').fullCalendar('option', 'minTime', minTime);
                $('#calendar').fullCalendar('option', 'maxTime', maxTime);
                $('#calendar').fullCalendar('option', 'hiddenDays', hiddenDays);
                $('#calendar').fullCalendar('render');
            },
            downloadIcs: function() {
                var cal = ics(this.app.domain, this.app.name, this.app.domain, {
                    TZID: "Asia/Hong_Kong",
                    TZNAME: "HKT",
                    OFFSETFROM: "+0800",
                    OFFSETTO: "+0800",
                    START: "19700101T000000"
                });

                function _(s) {
                    return s ? s : ""
                };

                var applicableEvents = this.getApplicableEvents(true); // true for ics events

                for (var i = 0; i < applicableEvents.length; i++) {
                    var eventArray = applicableEvents[i];

                    for (var j = 0; j < eventArray.length; j++) {
                        var event = eventArray[j];
                        cal.addEvent(
                            _(event.title),
                            _(event.description),
                            _(event.venue),
                            event.start,
                            event.end,
                            event.allDay,
                            event.recursiveOpts
                        );
                    }
                }

                var blob = new Blob([cal.calendar()], {
                    type: "text/calendar;charset=utf-8"
                });
                saveAs(blob, "timetable.ics", true); // true to kill the BOM shit
            },
            renderImages: function(resultCallback) {
                var app = this;
                var canvas = [];
                $('#calendar').fullCalendar('gotoDate', app.calData.firstLesson);
                $('#calendar').fullCalendar('changeView', 'agendaWeek');

                var onFinish = function(result) {
                    $('#calendar').fullCalendar('gotoDate', app.calData.firstLesson);
                    resultCallback(result);
                }

                function renderNext() {

                    html2canvas($('#calendar>.fc-view-container')).then(function(c) {
                        var ctx = c.getContext('2d');
                        ctx.webkitImageSmoothingEnabled = false;
                        ctx.mozImageSmoothingEnabled = false;
                        ctx.imageSmoothingEnabled = false;

                        canvas.push({
                            date: $('#calendar').fullCalendar('getDate'),
                            canvas: c
                        });

                        if ($('#calendar').fullCalendar('getDate').endOf('week')
                            .isSameOrAfter(app.calData.lastLesson.endOf('week'))) {
                            onFinish(canvas);
                            return;
                        }
                        app.imageRenderingNumber = canvas.length;

                        $('#calendar').fullCalendar('next');
                        setTimeout(renderNext, 500);
                    });
                }

                setTimeout(renderNext, 500);
            },
            downloadImages: function() {
                var app = this;
                app.imageRendering = true;
                app.imageRenderingProcess = "Rendering";

                $('#calendar-wrapper').css('opacity', 0);
                $('#calendar-wrapper').css('width', '1000px');
                $('body').css('overflow', 'hidden');
                window.scrollTo(0, 0);

                var zipFile = new JSZip();
                var timetableZip = zipFile.folder("timetable");

                this.renderImages(function(canvas) {

                    app.imageRenderingProcess = "Zipping";

                    (function next(i, then) {
                        app.imageRenderingNumber = i;

                        canvas[i].canvas.toBlob(function(blob) {
                            timetableZip.file(
                                canvas[i].date.startOf('week').format('YYYYMMDD') + '-' +
                                canvas[i].date.endOf('week').format('YYYYMMDD') + ".png",
                                blob);

                            // FIXME: use Promise
                            if (i < canvas.length - 1)
                                next(i + 1, then);
                            else
                                then();
                        });

                    })(0, function() {
                        app.imageRenderingProcess = "Finalizing";

                        zipFile.generateAsync({
                            type: "blob"
                        }).then(function(content) {
                            $('#calendar-wrapper').css('opacity', 1);
                            $('#calendar-wrapper').css('width', 'initial');
                            $('body').css('overflow', 'initial');

                            app.imageRendering = false;

                            saveAs(content, "timetable.zip");
                        });
                    });
                });
            }
        }
    });

    Vue.component('lesson', {
        props: ['lesson'],
        template: '<tr><td>{{ lesson.course.subjectCode }}</td><td>{{ lesson.course.subjectTitle }}</td><td>{{ lesson.course.group }}</td><td>{{ lesson.activity }}</td><td>{{ lesson.day }}</td><td>{{ lesson.startTime }}</td><td>{{ lesson.endTime }}</td><td>{{ lesson.venue }}</td><td>{{ lesson.startWeek }}</td><td>{{ lesson.endWeek }}</td><td>{{ lesson.forEvery }}</td></tr>'
    });

    Vue.component('course', {
        props: ['course'],
        template: '<tr><td>{{ course.subjectCode }}</td><td><input class="form-control" v-model="course.subjectTitle"></td><td>{{ course.group }}</td><td><input type="color" v-model="course.color"/></td></tr>'
    });

    Vue.filter('mask', function (str) {
      return str.replace(/(Student No\.:\s+|Name:\s+)([^\t]+)\t/g, "$1***\t");
    })
});
