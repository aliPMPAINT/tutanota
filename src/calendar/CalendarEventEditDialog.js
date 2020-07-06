//@flow
import {px, size} from "../gui/size"
import stream from "mithril/stream/stream.js"
import {DatePicker} from "../gui/base/DatePicker"
import {Dialog} from "../gui/base/Dialog"
import type {CalendarInfo} from "./CalendarView"
import m from "mithril"
import {TextFieldN, Type as TextFieldType} from "../gui/base/TextFieldN"
import {lang} from "../misc/LanguageViewModel"
import type {DropDownSelectorAttrs, SelectorItemList} from "../gui/base/DropDownSelectorN"
import {DropDownSelectorN} from "../gui/base/DropDownSelectorN"
import {Icons} from "../gui/base/icons/Icons"
import type {CalendarEvent} from "../api/entities/tutanota/CalendarEvent"
import {downcast, memoized, noOp} from "../api/common/utils/Utils"
import type {ButtonAttrs} from "../gui/base/ButtonN"
import {ButtonN, ButtonType} from "../gui/base/ButtonN"
import type {CalendarAttendeeStatusEnum} from "../api/common/TutanotaConstants"
import {AlarmInterval, CalendarAttendeeStatus, EndType, Keys, RepeatPeriod} from "../api/common/TutanotaConstants"
import {findAndRemove, numberRange, remove} from "../api/common/utils/ArrayUtils"
import {calendarAttendeeStatusDescription, getCalendarName, getStartOfTheWeekOffsetForUser} from "./CalendarUtils"
import {TimePicker} from "../gui/base/TimePicker"
import {getDisplayText} from "../mail/MailUtils"
import type {MailboxDetail} from "../mail/MailModel"
import {Bubble, BubbleTextField} from "../gui/base/BubbleTextField"
import {MailAddressBubbleHandler} from "../misc/MailAddressBubbleHandler"
import type {Contact} from "../api/entities/tutanota/Contact"
import {attachDropdown, createDropdown} from "../gui/base/DropdownN"
import {HtmlEditor} from "../gui/base/HtmlEditor"
import {Icon} from "../gui/base/Icon"
import {BootIcons} from "../gui/base/icons/BootIcons"
import {CheckboxN} from "../gui/base/CheckboxN"
import {ExpanderButtonN, ExpanderPanelN} from "../gui/base/ExpanderN"
import {client} from "../misc/ClientDetector"
import {locator} from "../api/main/MainLocator"
import type {Guest} from "./CalendarEventViewModel"
import {CalendarEventViewModel} from "./CalendarEventViewModel"
import {theme} from "../gui/theme"
import type {RecipientInfo} from "../api/common/RecipientInfo"
import {RecipientInfoType} from "../api/common/RecipientInfo"
import {PasswordIndicator} from "../gui/base/PasswordIndicator"
import {getPasswordStrength} from "../misc/PasswordUtils"
import {animations, height} from "../gui/animation/Animations"
import {UserError} from "../api/common/error/UserError"

const iconForStatus = {
	[CalendarAttendeeStatus.ACCEPTED]: Icons.CircleCheckmark,
	[CalendarAttendeeStatus.TENTATIVE]: Icons.CircleHelp,
	[CalendarAttendeeStatus.DECLINED]: Icons.CircleReject,
	[CalendarAttendeeStatus.NEEDS_ACTION]: Icons.CircleEmpty,
}

const alarmIntervalItems = [
	{name: lang.get("comboBoxSelectionNone_msg"), value: null},
	{name: lang.get("calendarReminderIntervalFiveMinutes_label"), value: AlarmInterval.FIVE_MINUTES},
	{name: lang.get("calendarReminderIntervalTenMinutes_label"), value: AlarmInterval.TEN_MINUTES},
	{name: lang.get("calendarReminderIntervalThirtyMinutes_label"), value: AlarmInterval.THIRTY_MINUTES},
	{name: lang.get("calendarReminderIntervalOneHour_label"), value: AlarmInterval.ONE_HOUR},
	{name: lang.get("calendarReminderIntervalOneDay_label"), value: AlarmInterval.ONE_DAY},
	{name: lang.get("calendarReminderIntervalTwoDays_label"), value: AlarmInterval.TWO_DAYS},
	{name: lang.get("calendarReminderIntervalThreeDays_label"), value: AlarmInterval.THREE_DAYS},
	{name: lang.get("calendarReminderIntervalOneWeek_label"), value: AlarmInterval.ONE_WEEK}
]

export function showCalendarEventDialog(date: Date, calendars: Map<Id, CalendarInfo>, mailboxDetail: MailboxDetail,
                                        existingEvent?: CalendarEvent) {
	locator.calendarEventViewModel(date, calendars, mailboxDetail, existingEvent).then((viewModel) => {
		const startOfTheWeekOffset = getStartOfTheWeekOffsetForUser()
		const startDatePicker = new DatePicker(startOfTheWeekOffset, "dateFrom_label", "emptyString_msg", true, viewModel.readOnly)
		const endDatePicker = new DatePicker(startOfTheWeekOffset, "dateTo_label", "emptyString_msg", true, viewModel.readOnly)
		startDatePicker.date.map((date) => viewModel.onStartDateSelected(date))
		endDatePicker.date.map((date) => viewModel.onEndDateSelected(date))

		const repeatValues = createRepeatValues()
		const intervalValues = createIntevalValues()
		const endTypeValues = createEndTypeValues()
		const repeatEndDatePicker = new DatePicker(startOfTheWeekOffset, "emptyString_msg", "emptyString_msg", true)
		repeatEndDatePicker.date.map((date) => viewModel.onRepeatEndDateSelected(date))


		const endOccurrencesStream = memoized(stream)

		function renderEndValue(): Children {
			if (viewModel.repeat == null || viewModel.repeat.endType === EndType.Never) {
				return null
			} else if (viewModel.repeat.endType === EndType.Count) {
				return m(DropDownSelectorN, {
					label: "emptyString_msg",
					items: intervalValues,
					selectedValue: endOccurrencesStream(viewModel.repeat.endValue),
					selectionChangedHandler: (endValue: number) => viewModel.onEndOccurencesSelected(endValue),
					icon: BootIcons.Expand,
				})
			} else if (viewModel.repeat.endType === EndType.UntilDate) {
				repeatEndDatePicker.setDate(new Date(viewModel.repeat.endValue))
				return m(repeatEndDatePicker)
			} else {
				return null
			}
		}

		const editorOptions = {enabled: false, alignmentEnabled: false, fontSizeEnabled: false}
		const descriptionEditor = new HtmlEditor("description_label", editorOptions, () => m(ButtonN, {
				label: "emptyString_msg",
				title: 'showRichTextToolbar_action',
				icon: () => Icons.FontSize,
				click: () => editorOptions.enabled = !editorOptions.enabled,
				isSelected: () => editorOptions.enabled,
				noBubble: true,
				type: ButtonType.Toggle,
			})
		)
			.setMinHeight(400)
			.showBorders()
			.setEnabled(!viewModel.readOnly)
			// We only set it once, we don't viewModel on every change, that would be slow
			.setValue(viewModel.note)

		const okAction = (dialog) => {
			const description = descriptionEditor.getValue()
			if (description === "<div><br></div>") {
				viewModel.changeDescription("")
			} else {
				viewModel.changeDescription(description)
			}
			viewModel.onOkPressed().then(({askForUpdates}) => {
				if (askForUpdates) {
					const alertDialog = Dialog.alert("sendUpdates_msg", [
						{
							label: "cancel_action",
							click: () => alertDialog.close(),
							type: ButtonType.Secondary
						}, {
							label: "no_label",
							click: () => {
								askForUpdates(false).then(finish)
								alertDialog.close()
							},
							type: ButtonType.Secondary
						}, {
							label: "yes_label",
							click: () => {
								askForUpdates(true).then(finish)
								alertDialog.close()
							},
							type: ButtonType.Primary,
						}
					], (positive) => positive ? askForUpdates(true).then(finish) : finish())
				} else {
					finish()
				}
			}).catch(UserError, (e) => Dialog.error(e.msgKey))
		}

		const attendeesField = makeBubbleHandler(viewModel, (bubble) => {
			viewModel.addAttendee(bubble.entity.mailAddress, bubble.entity.contact)
			remove(attendeesField.bubbles, bubble)
		})

		const attendeesExpanded = stream(viewModel.attendees().length > 0)

		const renderInvitationField = (): Children => viewModel.canModifyGuests()
			? m(".mt-negative-m", m(attendeesField))
			: null

		function renderAttendees() {
			const ownAttendee = viewModel.findOwnAttendee()
			const guests = viewModel.attendees().slice()

			if (ownAttendee) {
				const indexOfOwn = guests.indexOf(ownAttendee)
				guests.splice(indexOfOwn, 1)
				guests.unshift(ownAttendee)
			}
			const externalGuests = viewModel.isConfidential()
				? guests.filter((a) => a.type === RecipientInfoType.EXTERNAL)
				        .map((guest) => {
					        return m(TextFieldN, {
						        value: stream(guest.password || ""),
						        type: TextFieldType.ExternalPassword,
						        label: () => lang.get("passwordFor_label", {"{1}": guest.address.address}),
						        helpLabel: () => m(new PasswordIndicator(() => getPasswordStrength(guest.password || "", []))),
						        oncreate: ({dom}) => animations.add(dom, height(0, dom.offsetHeight)),
						        onbeforeremove: ({dom}) => animations.add(dom, height(dom.offsetHeight, 0)),
						        key: guest.address.address,
						        oninput: (newValue) => viewModel.updatePassword(guest, newValue)
					        })
				        })
				: []
			return m("", [guests.map((guest, index) => renderGuest(guest, index, viewModel, ownAttendee)), externalGuests])
		}

		const renderDateTimePickers = () => renderTwoColumnsIfFits(
			[
				m(".flex-grow", m(startDatePicker)),
				!viewModel.allDay()
					? m(".ml-s.time-field", m(TimePicker, {
						value: viewModel.startTime,
						onselected: (time) => viewModel.onStartTimeSelected(time),
						amPmFormat: viewModel.amPmFormat,
						disabled: viewModel.readOnly
					}))
					: null
			],
			[
				m(".flex-grow", m(endDatePicker)),
				!viewModel.allDay()
					? m(".ml-s.time-field", m(TimePicker, {
						value: viewModel.endTime,
						onselected: (time) => viewModel.onEndTimeSelected(time),
						amPmFormat: viewModel.amPmFormat,
						disabled: viewModel.readOnly
					}))
					: null
			]
		)

		const renderLocationField = () => m(TextFieldN, {
			label: "location_label",
			value: viewModel.location,
			disabled: viewModel.readOnly,
			injectionsRight: () => {
				let address = encodeURIComponent(viewModel.location())
				if (address === "") {
					return null;
				}
				return m(ButtonN, {
					label: 'showAddress_alt',
					icon: () => Icons.Pin,
					click: () => {
						window.open(`https://www.openstreetmap.org/search?query=${address}`, '_blank')
					}
				})
			}
		})

		function renderCalendarPicker() {
			return m(".flex-half.pr-s", m(DropDownSelectorN, ({
				label: "calendar_label",
				items: viewModel.calendars.map((calendarInfo) => {
					return {name: getCalendarName(calendarInfo.groupInfo, calendarInfo.shared), value: calendarInfo}
				}),
				selectedValue: viewModel.selectedCalendar,
				icon: BootIcons.Expand,
				disabled: viewModel.readOnly
			}: DropDownSelectorAttrs<CalendarInfo>)))
		}

		// Avoid creating stream on each render. Will create new stream if the value is changed.
		// We could just change the value of the stream on each render but ultimately we should avoid
		// passing streams into components.
		const repeatFrequencyStream = memoized(stream)
		const repeatIntervalStream = memoized(stream)
		const endTypeStream = memoized(stream)

		function renderRepeatPeriod() {
			return m(DropDownSelectorN, {
				label: "calendarRepeating_label",
				items: repeatValues,
				selectedValue: repeatFrequencyStream(viewModel.repeat && viewModel.repeat.frequency || null),
				selectionChangedHandler: (period) => viewModel.onRepeatPeriodSelected(period),
				icon: BootIcons.Expand,
				disabled: viewModel.readOnly,
			})
		}

		function renderRepeatInterval() {
			return m(DropDownSelectorN, {
				label: "interval_title",
				items: intervalValues,
				selectedValue: repeatIntervalStream(viewModel.repeat && viewModel.repeat.interval || 1),
				selectionChangedHandler: (period) => viewModel.onRepeatIntervalChanged(period),
				icon: BootIcons.Expand,
				disabled: viewModel.readOnly
			})
		}

		function renderEndType(repeat) {
			return m(DropDownSelectorN, {
					label: () => lang.get("calendarRepeatStopCondition_label"),
					items: endTypeValues,
					selectedValue: endTypeStream(repeat.endType),
					selectionChangedHandler: (period) => viewModel.onRepeatEndTypeChanged(period),
					icon: BootIcons.Expand,
					disabled: viewModel.readOnly,
				}
			)
		}

		const renderRepeatRulePicker = () => renderTwoColumnsIfFits([
				// Repeat type == Frequency: Never, daily, annually etc
				m(".flex-grow.pr-s", renderRepeatPeriod()),
				// Repeat interval: every day, every second day etc
				m(".flex-grow.pl-s"
					+ (viewModel.repeat ? "" : ".hidden"), renderRepeatInterval()),
			],
			viewModel.repeat
				? [
					m(".flex-grow.pr-s", renderEndType(viewModel.repeat)),
					m(".flex-grow.pl-s", renderEndValue()),
				]
				: null
		)

		function renderChangesMessage() {
			return viewModel.existingEvent && viewModel.existingEvent.isCopy
				? m(".mt", lang.get("eventCopy_msg"))
				: null
		}

		function renderDialogContent() {
			startDatePicker.setDate(viewModel.startDate)
			endDatePicker.setDate(viewModel.endDate)

			return m(".calendar-edit-container.pb", [
					renderHeading(),
					renderChangesMessage(),
					renderDateTimePickers(),
					m(".flex.items-center", [
						m(CheckboxN, {
							checked: viewModel.allDay,
							disabled: viewModel.readOnly,
							label: () => lang.get("allDay_label")
						}),
						m(".flex-grow"),
						m(ExpanderButtonN, {
							label: "guests_label",
							expanded: attendeesExpanded,
							style: {paddingTop: 0},
						})
					]),
					m(ExpanderPanelN, {
							expanded: attendeesExpanded,
							class: "mb",
						},
						[
							m(".flex-grow", renderInvitationField()),
							m(".flex-grow", renderAttendees())
						],
					),
					renderRepeatRulePicker(),
					m(".flex", [
						renderCalendarPicker(),
						viewModel.canModifyAlarms()
							? m(".flex.col.flex-half.pl-s",
							[
								viewModel.alarms.map((a) => m(DropDownSelectorN, {
									label: "reminderBeforeEvent_label",
									items: alarmIntervalItems,
									selectedValue: stream(downcast(a.trigger)),
									icon: BootIcons.Expand,
									selectionChangedHandler: (value) => viewModel.changeAlarm(a.alarmIdentifier, value),
									key: a.alarmIdentifier
								})),
								m(DropDownSelectorN, {
									label: "reminderBeforeEvent_label",
									items: alarmIntervalItems,
									selectedValue: stream(null),
									icon: BootIcons.Expand,
									selectionChangedHandler: (value) => value && viewModel.addAlarm(value)
								})
							])
							: m(".flex.flex-half.pl-s"),
					]),
					renderLocationField(),
					m(descriptionEditor),
				]
			)
		}

		function finish() {
			viewModel.dispose()
			dialog.close()
		}

		function deleteEvent() {
			if (viewModel.existingEvent == null) {
				return Promise.resolve(true)
			}
			return Dialog.confirm("deleteEventConfirmation_msg").then((answer) => {
				if (answer) {
					viewModel.deleteEvent()
					finish()
				}
			})
		}

		const renderDeleteButton = () => (existingEvent && existingEvent._id && !viewModel.readOnly)
			? m(".mr-negative-s", m(ButtonN, {
					label: "delete_action",
					type: ButtonType.Action,
					icon: () => Icons.Trash,
					click: () => deleteEvent()
				}
			))
			: null

		const renderConfidentialButton = () => viewModel.attendees().find(a => a.type === RecipientInfoType.EXTERNAL)
			? m(ButtonN, {
					label: "confidential_action",
					click: () => viewModel.setConfidential(!viewModel.isConfidential()),
					icon: () => viewModel.isConfidential() ? Icons.Lock : Icons.Unlock,
					isSelected: () => viewModel.isConfidential(),
					noBubble: true,
				}
			)
			: null

		function renderHeading() {
			return m(".flex.items-end", [
				m(TextFieldN, {
					label: "title_placeholder",
					value: viewModel.summary,
					disabled: viewModel.readOnly,
					class: "big-input pt flex-grow mr-s"
				}),
				renderConfidentialButton(),
				renderDeleteButton(),
			])
		}

		viewModel.attendees.map(m.redraw)

		const dialog = Dialog.largeDialog(
			{
				left: [{label: "cancel_action", click: finish, type: ButtonType.Secondary}],
				right: [{label: "save_action", click: () => okAction(dialog), type: ButtonType.Primary}],
				middle: () => lang.get("createEvent_label"),
			},
			{view: () => m(".calendar-edit-container.pb", renderDialogContent())}
		).addShortcut({
			key: Keys.ESC,
			exec: finish,
			help: "close_alt"
		}).addShortcut({
			key: Keys.S,
			ctrl: true,
			exec: () => okAction(dialog),
			help: "save_action"
		})
		if (client.isMobileDevice()) {
			// Prevent focusing text field automatically on mobile. It opens keyboard and you don't see all details.
			dialog.setFocusOnLoadFunction(noOp)
		}
		dialog.show()
	})
}


function renderStatusIcon(viewModel: CalendarEventViewModel, attendee: Guest, ownAttendee: ?Guest): Children {
	const icon = iconForStatus[attendee.status]

	const editable = ownAttendee === attendee && viewModel.canModifyOwnAttendance()

	const selectors: SelectorItemList<CalendarAttendeeStatusEnum> = [
		{name: "Yes", value: CalendarAttendeeStatus.ACCEPTED},
		{name: "Maybe", value: CalendarAttendeeStatus.TENTATIVE},
		{name: "No", value: CalendarAttendeeStatus.DECLINED},
	]

	const iconElement = icon
		? m(Icon, {icon, large: true})
		: m(".icon-large", {
			style: {display: "block"}
		})
	const status: CalendarAttendeeStatusEnum = downcast(attendee.status)

	return m("button.button-width.flex.items-center", {
		title: calendarAttendeeStatusDescription(status),
		disabled: !editable ? "true" : null,
		onclick: (e) => {
			if (editable) {
				const openDropdown = createDropdown(() => {
					return selectors.map(selector => {
						const checkedIcon = selector.icon
						return {
							label: () => selector.name,
							click: () => viewModel.selectGoing(selector.value),
							type: ButtonType.Dropdown,
							icon: checkedIcon ? () => checkedIcon : null
						}
					})
				})
				openDropdown(e, e.target)
			}
		}
	}, [
		iconElement,
		editable ? m(Icon, {icon: BootIcons.Expand, style: {fill: theme.content_button}}) : m(".icon")
	])
}


function createRepeatValues() {
	return [
		{name: lang.get("calendarRepeatIntervalNoRepeat_label"), value: null},
		{name: lang.get("calendarRepeatIntervalDaily_label"), value: RepeatPeriod.DAILY},
		{name: lang.get("calendarRepeatIntervalWeekly_label"), value: RepeatPeriod.WEEKLY},
		{name: lang.get("calendarRepeatIntervalMonthly_label"), value: RepeatPeriod.MONTHLY},
		{name: lang.get("calendarRepeatIntervalAnnually_label"), value: RepeatPeriod.ANNUALLY}
	]
}

function createIntevalValues() {
	return numberRange(1, 256).map(n => {
		return {name: String(n), value: n}
	})
}

function createEndTypeValues() {
	return [
		{name: lang.get("calendarRepeatStopConditionNever_label"), value: EndType.Never},
		{name: lang.get("calendarRepeatStopConditionOccurrences_label"), value: EndType.Count},
		{name: lang.get("calendarRepeatStopConditionDate_label"), value: EndType.UntilDate}
	]
}

function makeBubbleHandler(viewModel: CalendarEventViewModel, onBubbleCreated: (Bubble<RecipientInfo>) => void): BubbleTextField<RecipientInfo> {
	function createBubbleContextButtons(name: string, mailAddress: string): Array<ButtonAttrs | string> {
		let buttonAttrs = [mailAddress]
		buttonAttrs.push({
			label: "remove_action",
			type: ButtonType.Secondary,
			click: () => {
				findAndRemove(invitePeopleValueTextField.bubbles, (bubble) => bubble.entity.mailAddress === mailAddress)
			},
		})
		return buttonAttrs
	}

	const bubbleHandler = new MailAddressBubbleHandler({
		createBubble(name: ?string, mailAddress: string, contact: ?Contact): Bubble<RecipientInfo> {
			const recipientInfo = viewModel.createRecipientInfo(name, mailAddress, contact)
			const buttonAttrs = attachDropdown({
				label: () => getDisplayText(recipientInfo.name, mailAddress, false),
				type: ButtonType.TextBubble,
				isSelected: () => false,
			}, () => createBubbleContextButtons(recipientInfo.name, mailAddress))
			const bubble = new Bubble(recipientInfo, buttonAttrs, mailAddress)
			Promise.resolve().then(() => onBubbleCreated(bubble))
			return bubble
		},

	})

	const invitePeopleValueTextField = new BubbleTextField("addGuest_label", bubbleHandler, {marginLeft: 0})
	return invitePeopleValueTextField
}

function renderTwoColumnsIfFits(left: Children, right: Children): Children {
	if (client.isMobileDevice()) {
		return m(".flex.col", [
			m(".flex", left),
			m(".flex", right),
		])
	} else {
		return m(".flex", [
			m(".flex.flex-half.pr-s", left),
			m(".flex.flex-half.pl-s", right),
		])
	}
}


function renderGuest(guest: Guest, index: number, viewModel: CalendarEventViewModel, ownAttendee: ?Guest): Children {
	const {organizer} = viewModel
	const isOrganizer = organizer && guest.address.address === organizer.address
	return m(".flex", {
		style: {
			height: px(size.button_height),
			borderBottom: "1px transparent",
			marginTop: index === 0 && !viewModel.canModifyGuests() ? 0 : px(size.vpad),
		},
	}, [
		m(".flex.col.flex-grow.overflow-hidden.flex-no-grow-shrink-auto", [
			m(".flex.flex-grow.items-center",
				m("div.text-ellipsis", {style: {lineHeight: px(24)}},
					guest.address.name ? `${guest.address.name} ${guest.address.address}` : guest.address.address
				),
			),
			m(".small", lang.get(isOrganizer ? "organizer_label" : "guest_label")
				+ (guest === ownAttendee ? ` | ${lang.get("you_label")}` : "")),
		]),
		m(".flex-grow"),
		[
			isOrganizer && viewModel.canModifyOrganizer()
				? m(".mr-s.flew-grow", m(ButtonN, {
					label: "edit_action",
					type: ButtonType.Secondary,
					click: createDropdown(() => {
						return viewModel.possibleOrganizers.map((organizer) => {
								return {
									label: () => organizer.address,
									click: () => viewModel.setOrganizer(organizer),
									type: ButtonType.Dropdown
								}
							}
						)
					}, 300)
				}))
				: null,
			!isOrganizer && viewModel.canModifyGuests()
				? m(".mr-s-flex-grow", m(ButtonN, {
					label: "remove_action",
					type: ButtonType.Secondary,
					click: () => viewModel.removeAttendee(guest)
				}))
				: null,
			renderStatusIcon(viewModel, guest, ownAttendee)
		]
	])
}