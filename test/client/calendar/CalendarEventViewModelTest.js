//@flow
import o from "ospec/ospec.js"
import type {EventCreateResult} from "../../../src/calendar/CalendarEventViewModel"
import {CalendarEventViewModel} from "../../../src/calendar/CalendarEventViewModel"
import {downcast} from "../../../src/api/common/utils/Utils"
import {LazyLoaded} from "../../../src/api/common/utils/LazyLoaded"
import type {MailboxDetail} from "../../../src/mail/MailModel"
import {MailModel} from "../../../src/mail/MailModel"
import type {CalendarEvent} from "../../../src/api/entities/tutanota/CalendarEvent"
import {createCalendarEvent} from "../../../src/api/entities/tutanota/CalendarEvent"
import {createGroupInfo} from "../../../src/api/entities/sys/GroupInfo"
import type {ShareCapabilityEnum} from "../../../src/api/common/TutanotaConstants"
import {AlarmInterval, CalendarAttendeeStatus, GroupType, ShareCapability, TimeFormat} from "../../../src/api/common/TutanotaConstants"
import type {CalendarInfo} from "../../../src/calendar/CalendarView"
import {createGroupMembership} from "../../../src/api/entities/sys/GroupMembership"
import type {User} from "../../../src/api/entities/sys/User"
import {createUser} from "../../../src/api/entities/sys/User"
import {createCalendarEventAttendee} from "../../../src/api/entities/tutanota/CalendarEventAttendee"
import {createMailBox} from "../../../src/api/entities/tutanota/MailBox"
import {createGroup} from "../../../src/api/entities/sys/Group"
import {createMailboxGroupRoot} from "../../../src/api/entities/tutanota/MailboxGroupRoot"
import type {CalendarUpdateDistributor} from "../../../src/calendar/CalendarUpdateDistributor"
import type {IUserController} from "../../../src/api/main/UserController"
import {createEncryptedMailAddress} from "../../../src/api/entities/tutanota/EncryptedMailAddress"
import {CalendarModel} from "../../../src/calendar/CalendarModel"
import {getAllDayDateUTCFromZone} from "../../../src/calendar/CalendarUtils"
import {DateTime} from "luxon"
import {createMailAddressAlias} from "../../../src/api/entities/sys/MailAddressAlias"
import {RecipientInfoType} from "../../../src/api/common/RecipientInfo"
import type {ContactModel} from "../../../src/contacts/ContactModel"

const calendarGroupId = "0"
const now = new Date(2020, 4, 25, 13, 40)
const zone = "Europe/Berlin"
const wrapIntoMailAddress = (address) => createEncryptedMailAddress({address})
const mailAddress = wrapIntoMailAddress("address@tutanota.com")
const userId = "12356"

o.spec("CalendarEventViewModel", function () {
	o("init with existing event", function () {
		const existingEvent = createCalendarEvent({
			summary: "existing event",
			startTime: DateTime.fromObject({year: 2020, month: 5, day: 26, hour: 12, zone}).toJSDate(),
			endTime: DateTime.fromObject({year: 2020, month: 5, day: 26, hour: 13, zone}).toJSDate(),
			description: "note",
			location: "location",
			_ownerGroup: calendarGroupId,
			organizer: mailAddress,
			description: "descr"
		})
		const viewModel = init({calendars: makeCalendars("own"), existingEvent})

		o(viewModel.summary()).equals(existingEvent.summary)
		o(viewModel.startDate.toISOString()).equals(DateTime.fromObject({year: 2020, month: 5, day: 26, zone}).toJSDate().toISOString())
		o(viewModel.endDate.toISOString()).equals(DateTime.fromObject({year: 2020, month: 5, day: 26, zone}).toJSDate().toISOString())
		o(viewModel.startTime).equals("12:00")
		o(viewModel.endTime).equals("13:00")
		o(viewModel.note).equals(existingEvent.description)
		o(viewModel.location()).equals(existingEvent.location)
		o(viewModel.readOnly).equals(false)
		o(viewModel.canModifyGuests()).equals(true)("canModifyGuests")
		o(viewModel.canModifyOwnAttendance()).equals(true)
		o(viewModel.canModifyOrganizer()).equals(true)
		o(viewModel.organizer).equals(mailAddress)
		o(viewModel.possibleOrganizers).deepEquals([mailAddress])
	})

	o("init all day event", function () {
		const existingEvent = createCalendarEvent({
			summary: "existing event",
			startTime: getAllDayDateUTCFromZone(DateTime.fromObject({year: 2020, month: 5, day: 26, zone}).toJSDate(), zone),
			endTime: getAllDayDateUTCFromZone(DateTime.fromObject({year: 2020, month: 5, day: 27, zone}).toJSDate(), zone),
			description: "note",
			location: "location",
			_ownerGroup: calendarGroupId,
		})
		const viewModel = init({calendars: makeCalendars("own"), existingEvent})

		o(viewModel.summary()).equals(existingEvent.summary)
		o(viewModel.startDate.toISOString()).equals(DateTime.fromObject({year: 2020, month: 5, day: 26, zone}).toJSDate().toISOString())
		o(viewModel.endDate.toISOString()).equals(DateTime.fromObject({year: 2020, month: 5, day: 26, zone}).toJSDate().toISOString())
	})

	o("invite in our own calendar", function () {
		const existingEvent = createCalendarEvent({
			summary: "existing event",
			startTime: new Date(2020, 4, 26, 12),
			endTime: new Date(2020, 4, 26, 13),
			organizer: wrapIntoMailAddress("another-user@provider.com"),
			_ownerGroup: calendarGroupId,
			isCopy: true,
			attendees: [
				createCalendarEventAttendee({
					address: createEncryptedMailAddress({address: "attendee@example.com"})
				}),
				createCalendarEventAttendee({
					address: mailAddress
				})
			]
		})
		const viewModel = init({calendars: makeCalendars("own"), existingEvent})
		o(viewModel.readOnly).equals(false)
		o(viewModel.canModifyGuests()).equals(false)
		o(viewModel.canModifyOwnAttendance()).equals(true)
		o(viewModel.canModifyOrganizer()).equals(false)
		o(viewModel.possibleOrganizers).deepEquals([existingEvent.organizer])
	})

	o("new invite (without calendar)", function () {
		const calendars = makeCalendars("own")
		const existingEvent = createCalendarEvent({
			summary: "existing event",
			startTime: new Date(2020, 4, 26, 12),
			endTime: new Date(2020, 4, 26, 13),
			organizer: wrapIntoMailAddress("another-user@provider.com"),
			_ownerGroup: null,
			isCopy: true,
			attendees: [
				createCalendarEventAttendee({
					address: mailAddress,
					status: CalendarAttendeeStatus.ACCEPTED,
				})
			]
		})
		const viewModel = init({calendars, existingEvent})
		o(viewModel.readOnly).equals(false)
		o(viewModel.canModifyGuests()).equals(false)
		o(viewModel.canModifyOwnAttendance()).equals(true)
		o(viewModel.canModifyOrganizer()).equals(false)
		o(viewModel.possibleOrganizers).deepEquals([existingEvent.organizer])
		o(viewModel.going).equals(CalendarAttendeeStatus.ACCEPTED)
	})

	o("in writable calendar", function () {
		const calendars = makeCalendars("shared")
		const userController = makeUserController()
		addCapability(userController.user, calendarGroupId, ShareCapability.Write)
		const existingEvent = createCalendarEvent({
			summary: "existing event",
			startTime: new Date(2020, 4, 26, 12),
			endTime: new Date(2020, 4, 26, 13),
			organizer: wrapIntoMailAddress("another-user@provider.com"),
			_ownerGroup: calendarGroupId,
		})
		const viewModel = init({calendars, existingEvent, userController})
		o(viewModel.readOnly).equals(false)
		o(viewModel.canModifyGuests()).equals(false)
		o(viewModel.canModifyOwnAttendance()).equals(false)
		o(viewModel.canModifyOrganizer()).equals(false)
		o(viewModel.possibleOrganizers).deepEquals([existingEvent.organizer])
	})

	o("invite in writable calendar", function () {
		const calendars = makeCalendars("shared")
		const userController = makeUserController()
		addCapability(userController.user, calendarGroupId, ShareCapability.Write)
		const existingEvent = createCalendarEvent({
			summary: "existing event",
			startTime: new Date(2020, 4, 26, 12),
			endTime: new Date(2020, 4, 26, 13),
			organizer: wrapIntoMailAddress("another-user@provider.com"),
			_ownerGroup: calendarGroupId,
			isCopy: true,
		})
		const viewModel = init({calendars, existingEvent, userController})
		o(viewModel.readOnly).equals(false)
		o(viewModel.canModifyGuests()).equals(false)
		o(viewModel.canModifyOwnAttendance()).equals(false)
		o(viewModel.canModifyOrganizer()).equals(false)
		o(viewModel.possibleOrganizers).deepEquals([existingEvent.organizer])
	})

	o("in readonly calendar", function () {
		const calendars = makeCalendars("shared")
		const userController = makeUserController()
		addCapability(userController.user, calendarGroupId, ShareCapability.Read)
		const existingEvent = createCalendarEvent({
			_ownerGroup: calendarGroupId,
		})
		const viewModel = init({calendars, existingEvent, userController})

		o(viewModel.readOnly).equals(true)
		o(viewModel.canModifyGuests()).equals(false)("canModifyGuests")
		o(viewModel.canModifyOwnAttendance()).equals(false)
		o(viewModel.canModifyOrganizer()).equals(false)
	})

	o("in writable calendar w/ guests", function () {
		const calendars = makeCalendars("shared")
		const userController = makeUserController()
		addCapability(userController.user, calendarGroupId, ShareCapability.Write)
		const existingEvent = createCalendarEvent({
			summary: "existing event",
			startTime: new Date(2020, 4, 26, 12),
			endTime: new Date(2020, 4, 26, 13),
			organizer: wrapIntoMailAddress("another-user@provider.com"),
			_ownerGroup: calendarGroupId,
			attendees: [
				createCalendarEventAttendee({
					address: createEncryptedMailAddress({address: "attendee@example.com"})
				})
			]
		})
		const viewModel = init({calendars, userController, existingEvent})
		o(viewModel.readOnly).equals(true)
		o(viewModel.canModifyGuests()).equals(false)
		o(viewModel.canModifyOwnAttendance()).equals(false)
		o(viewModel.canModifyOrganizer()).equals(false)
		o(viewModel.possibleOrganizers).deepEquals([existingEvent.organizer])
	})

	o.spec("delete event", function () {
		o("own event with attendees in own calendar", async function () {
			const calendars = makeCalendars("own")
			const distributor = makeDistributor()
			const attendee = makeAttendee()
			const ownAttendee = makeAttendee(mailAddress.address)
			const calendarModel = makeCalendarModel()
			const existingEvent = createCalendarEvent({
				_id: ["listid", "calendarid"],
				_ownerGroup: calendarGroupId,
				organizer: mailAddress,
				attendees: [ownAttendee, attendee],
				sequence: "1",
			})
			const newEvent = createCalendarEvent({
				_id: ["listid", "calendarid"],
				_ownerGroup: calendarGroupId,
				organizer: mailAddress,
				attendees: [ownAttendee, attendee],
				sequence: "2",
			})
			const viewModel = init({calendars, existingEvent, calendarModel, distributor})

			await viewModel.deleteEvent()

			o(calendarModel.deleteEvent.calls.map(c => c.args)).deepEquals([[existingEvent]])
			o(distributor.sendCancellation.calls.map(c => c.args)).deepEquals([[newEvent, [attendee.address]]])
		})

		o("own event without attendees in own calendar", async function () {
			const calendars = makeCalendars("own")
			const distributor = makeDistributor()
			const calendarModel = makeCalendarModel()
			const existingEvent = createCalendarEvent({
				_id: ["listid", "calendarid"],
				_ownerGroup: calendarGroupId,
				organizer: mailAddress,
				attendees: []
			})
			const viewModel = init({calendars, existingEvent, calendarModel, distributor})
			await viewModel.deleteEvent()
			o(calendarModel.deleteEvent.calls.map(c => c.args)).deepEquals([[existingEvent]])
			o(distributor.sendCancellation.calls).deepEquals([])
		})

		o("invite in own calendar", async function () {
			const calendars = makeCalendars("own")
			const distributor = makeDistributor()
			const calendarModel = makeCalendarModel()
			const attendee = makeAttendee()
			const existingEvent = createCalendarEvent({
				_id: ["listid", "calendarid"],
				_ownerGroup: calendarGroupId,
				organizer: wrapIntoMailAddress("another-address@example.com"),
				attendees: [attendee],
				isCopy: true,
			})
			const viewModel = init({calendars, existingEvent, calendarModel, distributor})
			await viewModel.deleteEvent()
			o(calendarModel.deleteEvent.calls.map(c => c.args)).deepEquals([[existingEvent]])
			o(distributor.sendCancellation.calls).deepEquals([])
		})

		o("in shared calendar", async function () {
			const calendars = makeCalendars("shared")
			const userController = makeUserController()
			addCapability(userController.user, calendarGroupId, ShareCapability.Write)
			const distributor = makeDistributor()
			const calendarModel = makeCalendarModel()
			const attendee = makeAttendee()
			const existingEvent = createCalendarEvent({
				_id: ["listid", "calendarid"],
				_ownerGroup: calendarGroupId,
				organizer: mailAddress,
				attendees: [attendee],
			})
			const viewModel = init({calendars, existingEvent, calendarModel, distributor})
			await viewModel.deleteEvent()
			o(calendarModel.deleteEvent.calls.map(c => c.args)).deepEquals([[existingEvent]])
			o(distributor.sendCancellation.calls).deepEquals([])
		})
	})

	o.spec("create event", function () {
		o("own calendar, no guests", async function () {
			const calendars = makeCalendars("own")
			const calendarModel = makeCalendarModel()
			const distributor = makeDistributor()
			const viewModel = init({calendars, existingEvent: null, calendarModel, distributor})
			const summary = "Summary"
			viewModel.summary(summary)
			const newDescription = "new description"
			viewModel.changeDescription(newDescription)

			o(await viewModel.onOkPressed()).deepEquals({status: "ok", askForUpdates: null})

			const [createdEvent] = calendarModel.createEvent.calls[0].args
			o(createdEvent.summary).equals("Summary")
			o(createdEvent.description).equals(newDescription)
			o(distributor.sendInvite.calls).deepEquals([])
			o(distributor.sendCancellation.calls).deepEquals([])
		})

		o("own calendar, new guests", async function () {
			const calendars = makeCalendars("own")
			const calendarModel = makeCalendarModel()
			const distributor = makeDistributor()
			const viewModel = init({calendars, existingEvent: null, calendarModel, distributor})
			const newGuest = "new-attendee@example.com"
			viewModel.addAttendee(newGuest)

			o(await viewModel.onOkPressed()).deepEquals({status: "ok", askForUpdates: null})
			o(calendarModel.createEvent.calls.length).equals(1)("created event")
			o(distributor.sendInvite.calls[0].args[1]).deepEquals([createEncryptedMailAddress({address: newGuest})])
			o(distributor.sendCancellation.calls).deepEquals([])
		})

		o("own calendar, same guests, agree on updates", async function () {
			const calendars = makeCalendars("own")
			const calendarModel = makeCalendarModel()
			const distributor = makeDistributor()
			const guest = "new-attendee@example.com"
			const existingEvent = createCalendarEvent({
				_id: ["listId", "eventId"],
				attendees: [
					createCalendarEventAttendee({
						address: createEncryptedMailAddress({address: guest})
					})
				],
				organizer: mailAddress,
				startTime: new Date(2020, 4, 5, 16),
				endTime: new Date(2020, 4, 6, 20),
			})
			const viewModel = init({calendars, existingEvent, calendarModel, distributor})
			viewModel.onStartDateSelected(new Date(2020, 4, 3))

			const result = await viewModel.onOkPressed()
			const askForUpdates = assertAskedForUpdates(result)
			o(distributor.sendUpdate.calls).deepEquals([])
			await askForUpdates(true)
			o(calendarModel.updateEvent.calls.length).equals(1)("created event")
			o(distributor.sendUpdate.calls[0].args[1]).deepEquals([createEncryptedMailAddress({address: guest})])
			o(distributor.sendCancellation.calls).deepEquals([])
		})

		o("own calendar, old, new, removed guests, agree on updates", async function () {
			const calendars = makeCalendars("own")
			const calendarModel = makeCalendarModel()
			const distributor = makeDistributor()
			const oldGuest = "old-attendee@example.com"
			const newGuest = "new-attendee@example.com"
			const toRemoveGuest = "remove-attendee@example.com"
			const toRemoveAttendee = createCalendarEventAttendee({
				address: createEncryptedMailAddress({address: toRemoveGuest})
			})
			const existingEvent = createCalendarEvent({
				_id: ["listId", "eventId"],
				attendees: [
					createCalendarEventAttendee({
						address: createEncryptedMailAddress({address: oldGuest})
					}),
					toRemoveAttendee
				],
				organizer: mailAddress,
				startTime: new Date(2020, 4, 5, 16),
				endTime: new Date(2020, 4, 6, 20),
			})
			const viewModel = init({calendars, existingEvent, calendarModel, distributor})
			viewModel.onStartDateSelected(new Date(2020, 4, 3))
			viewModel.addAttendee(newGuest)
			viewModel.removeAttendee(toRemoveGuest)

			const result = await viewModel.onOkPressed()
			const askForUpdates = assertAskedForUpdates(result)
			o(distributor.sendUpdate.calls).deepEquals([])
			await askForUpdates(true)

			o(calendarModel.updateEvent.calls.length).equals(1)("created event")
			o(distributor.sendUpdate.calls[0].args[1]).deepEquals([createEncryptedMailAddress({address: oldGuest})])("update")
			o(distributor.sendInvite.calls[0].args[1]).deepEquals([createEncryptedMailAddress({address: newGuest})])("invite")
			o(distributor.sendCancellation.calls[0].args[1]).deepEquals([toRemoveAttendee.address])("cancel")
		})

		o("own calendar, old, new, removed guests, do not send updates", async function () {
			const calendars = makeCalendars("own")
			const calendarModel = makeCalendarModel()
			const distributor = makeDistributor()
			const oldGuest = "old-attendee@example.com"
			const newGuest = "new-attendee@example.com"
			const toRemoveGuest = "remove-attendee@example.com"
			const toRemoveAttendee = createCalendarEventAttendee({
				address: createEncryptedMailAddress({address: toRemoveGuest})
			})
			const existingEvent = createCalendarEvent({
				_id: ["listId", "eventId"],
				attendees: [
					createCalendarEventAttendee({
						address: createEncryptedMailAddress({address: oldGuest})
					}),
					toRemoveAttendee
				],
				organizer: mailAddress,
				startTime: new Date(2020, 4, 5, 16),
				endTime: new Date(2020, 4, 6, 20),
			})
			const viewModel = init({calendars, existingEvent, calendarModel, distributor})
			viewModel.onStartDateSelected(new Date(2020, 4, 3))
			viewModel.addAttendee(newGuest)
			viewModel.removeAttendee(toRemoveGuest)

			const result = await viewModel.onOkPressed()
			const askForUpdates = assertAskedForUpdates(result)
			o(distributor.sendUpdate.calls).deepEquals([])
			await askForUpdates(false)

			o(calendarModel.updateEvent.calls.length).equals(1)("created event")
			o(distributor.sendUpdate.calls).deepEquals([])
			o(distributor.sendInvite.calls).deepEquals([])
			o(distributor.sendCancellation.calls).deepEquals([])
		})

		o("own calendar, only removed guests, send updates", async function () {
			const calendars = makeCalendars("own")
			const calendarModel = makeCalendarModel()
			const distributor = makeDistributor()
			const toRemoveGuest = "remove-attendee@example.com"
			const toRemoveAttendee = createCalendarEventAttendee({
				address: createEncryptedMailAddress({address: toRemoveGuest})
			})
			const existingEvent = createCalendarEvent({
				_id: ["listId", "eventId"],
				attendees: [
					toRemoveAttendee
				],
				organizer: mailAddress,
				startTime: new Date(2020, 4, 5, 16),
				endTime: new Date(2020, 4, 6, 20),
			})
			const viewModel = init({calendars, existingEvent, calendarModel, distributor})
			viewModel.onStartDateSelected(new Date(2020, 4, 3))
			viewModel.removeAttendee(toRemoveGuest)

			const result = await viewModel.onOkPressed()
			const askForUpdates = assertAskedForUpdates(result)
			o(distributor.sendUpdate.calls).deepEquals([])
			await askForUpdates(true)

			o(calendarModel.updateEvent.calls.length).equals(1)("created event")
			o(distributor.sendCancellation.calls[0].args[1]).deepEquals([toRemoveAttendee.address])
		})

		o("send response", async function () {
			const calendars = makeCalendars("own")
			const calendarModel = makeCalendarModel()
			const distributor = makeDistributor()
			const ownAttendee = createCalendarEventAttendee({
				address: mailAddress,
				status: CalendarAttendeeStatus.NEEDS_ACTION,
			})
			const anotherAttendee = createCalendarEventAttendee({
				address: createEncryptedMailAddress({address: "another-attendee@example.com"}),
				status: CalendarAttendeeStatus.DECLINED,
			})
			const existingEvent = createCalendarEvent({
				startTime: new Date(2020, 5, 1),
				endTime: new Date(2020, 5, 2),
				organizer: wrapIntoMailAddress("another-address@example.com"),
				attendees: [ownAttendee, anotherAttendee],
				isCopy: true,
			})
			const viewModel = init({calendars, existingEvent, calendarModel, distributor})
			viewModel.selectGoing(CalendarAttendeeStatus.ACCEPTED)
			const result = await viewModel.onOkPressed()

			o(result).deepEquals({status: "ok", askForUpdates: null})
			// As it is a "new" event, we must create it, not update
			const [createdEvent] = calendarModel.createEvent.calls[0].args
			o(createdEvent.attendees.length).equals(2)
			o(createdEvent.attendees.find(a =>
				a.address.address === ownAttendee.address.address).status).equals(CalendarAttendeeStatus.ACCEPTED)
			o(createdEvent.attendees.find(a =>
				a.address.address === anotherAttendee.address.address).status).equals(CalendarAttendeeStatus.DECLINED)
			o(createdEvent.isCopy).equals(true)
			o(distributor.sendUpdate.calls).deepEquals([])
			o(distributor.sendInvite.calls).deepEquals([])
			o(distributor.sendCancellation.calls).deepEquals([])
			const [_, sentSender, sentStatus] = distributor.sendResponse.calls[0].args
			o(sentSender.address).equals(mailAddress.address)
			o(sentStatus).equals(CalendarAttendeeStatus.ACCEPTED)
		})

		o("existing event times preserved", async function () {
			const calendars = makeCalendars("own")
			const calendarModel = makeCalendarModel()
			const startTime = DateTime.fromObject({year: 2020, month: 6, day: 4, hour: 12, zone}).toJSDate()
			const endTime = DateTime.fromObject({year: 2020, month: 6, day: 4, hour: 13, zone}).toJSDate()
			const existingEvent = createCalendarEvent({_id: ["listId", "eventId"], startTime, endTime})
			const viewModel = init({calendars, existingEvent, calendarModel})
			const result = await viewModel.onOkPressed()
			o(result).deepEquals({status: "ok", askForUpdates: null})
			const [createdEvent] = calendarModel.updateEvent.calls[0].args
			o(createdEvent.startTime.toISOString()).deepEquals(startTime.toISOString())
			o(createdEvent.endTime.toISOString()).deepEquals(endTime.toISOString())
		})

		o("invite to self is not sent", async function () {
			const calendars = makeCalendars("own")
			const calendarModel = makeCalendarModel()
			const distributor = makeDistributor()
			const viewModel = init({calendars, existingEvent: null, calendarModel, distributor})
			const newGuest = "new-attendee@example.com"
			viewModel.addAttendee(newGuest)
			viewModel.addAttendee(mailAddress.address)

			o(await viewModel.onOkPressed()).deepEquals({status: "ok", askForUpdates: null})
			o(calendarModel.createEvent.calls.length).equals(1)("created event")
			o(distributor.sendInvite.calls[0].args[1]).deepEquals([createEncryptedMailAddress({address: newGuest})])
			o(distributor.sendCancellation.calls).deepEquals([])
		})

		o("update to self is not sent", async function () {
			const calendars = makeCalendars("own")
			const distributor = makeDistributor()
			const ownAttendee = createCalendarEventAttendee({
				address: mailAddress,
				status: CalendarAttendeeStatus.NEEDS_ACTION,
			})
			const anotherAttendee = createCalendarEventAttendee({
				address: createEncryptedMailAddress({address: "another-attendee@example.com"}),
				status: CalendarAttendeeStatus.DECLINED,
			})
			const alias = "alias@tutanota.com"
			const userController = makeUserController([alias])
			const existingEvent = createCalendarEvent({
				startTime: new Date(2020, 5, 1),
				endTime: new Date(2020, 5, 2),
				organizer: wrapIntoMailAddress(alias),
				attendees: [ownAttendee, anotherAttendee],
			})
			const viewModel = init({calendars, distributor, userController, existingEvent})

			const result = await viewModel.onOkPressed()

			const askForUpdates = assertAskedForUpdates(result)
			await askForUpdates(true)
			o(distributor.sendUpdate.calls[0].args[1]).deepEquals([anotherAttendee.address])
		})

		o("invite is not called if only self is added", async function () {
			const calendars = makeCalendars("own")
			const distributor = makeDistributor()
			const anotherAttendee = createCalendarEventAttendee({
				address: createEncryptedMailAddress({address: "another-attendee@example.com"}),
				status: CalendarAttendeeStatus.DECLINED,
			})
			const alias = "alias@tutanota.com"
			const userController = makeUserController([alias])
			const existingEvent = createCalendarEvent({
				startTime: new Date(2020, 5, 1),
				endTime: new Date(2020, 5, 2),
				organizer: wrapIntoMailAddress(alias),
				attendees: [anotherAttendee],
			})
			const viewModel = init({calendars, distributor, userController, existingEvent})

			viewModel.addAttendee(mailAddress.address)
			const result = await viewModel.onOkPressed()

			// Update is asked because there's another attendee
			const askForUpdates = assertAskedForUpdates(result)
			await askForUpdates(true)
			o(distributor.sendUpdate.calls[0].args[1]).deepEquals([anotherAttendee.address])
			o(distributor.sendInvite.calls).deepEquals([])("Invite is not called")
		})

		o("does not ask for updates if only self is present", async function () {
			const calendars = makeCalendars("own")
			const distributor = makeDistributor()
			const ownAttendee = createCalendarEventAttendee({
				address: mailAddress,
				status: CalendarAttendeeStatus.NEEDS_ACTION,
			})
			const alias = "alias@tutanota.com"
			const userController = makeUserController([alias])
			const existingEvent = createCalendarEvent({
				startTime: new Date(2020, 5, 1),
				endTime: new Date(2020, 5, 2),
				organizer: wrapIntoMailAddress(alias),
				attendees: [ownAttendee],
			})
			const viewModel = init({calendars, distributor, userController, existingEvent})
			const result = await viewModel.onOkPressed()
			o(result).deepEquals({status: "ok", askForUpdates: null})
		})

		o("does not ask for updates if alarm is changed in shared calendar", async function () {
			const calendars = makeCalendars("shared")
			// TODO: add capability and test without capability
			const calendarModel = makeCalendarModel()
			const existingEvent = createCalendarEvent({
				_id: ["listId", "eventId"],
				organizer: wrapIntoMailAddress("organizer@tutanota.de"),
				startTime: DateTime.utc(2020, 6, 11).toJSDate(),
				endTime: DateTime.utc(2020, 7, 12).toJSDate(),
				attendees: [
					createCalendarEventAttendee({
						address: createEncryptedMailAddress({address: "guest@tutanota.com"})
					})
				]
			})
			const viewModel = init({calendarModel, calendars, existingEvent})

			viewModel.addAlarm(AlarmInterval.FIVE_MINUTES)
			const result = await viewModel.onOkPressed()

			o(result).deepEquals({status: "ok", askForUpdates: null})
			o(calendarModel.updateEvent.calls.length).equals(1)("Did update event")
		})
	})

	o.spec("onStartDateSelected", function () {
		o("date adjusted forward", async function () {
			const calendars = makeCalendars("own")
			const existingEvent = createCalendarEvent({
				startTime: DateTime.fromObject({year: 2020, month: 6, day: 8, hour: 13, zone}).toJSDate(),
				endTime: DateTime.fromObject({year: 2020, month: 6, day: 9, hour: 15, zone}).toJSDate(),
			})
			const viewModel = init({calendars, existingEvent})
			viewModel.onStartDateSelected(DateTime.fromObject({year: 2020, month: 6, day: 10, zone}).toJSDate())

			// No hours because it's a "date", not "time" field.
			o(viewModel.endDate.toISOString())
				.equals(DateTime.fromObject({year: 2020, month: 6, day: 11, zone}).toJSDate().toISOString())
			o(viewModel.endTime).equals("15:00")
		})

		o("date adjusted backwards", async function () {
			const calendars = makeCalendars("own")
			const existingEvent = createCalendarEvent({
				startTime: DateTime.fromObject({year: 2020, month: 6, day: 8, hour: 13, zone}).toJSDate(),
				endTime: DateTime.fromObject({year: 2020, month: 6, day: 9, hour: 15, zone}).toJSDate(),
			})
			const viewModel = init({calendars, existingEvent})
			viewModel.onStartDateSelected(DateTime.fromObject({year: 2020, month: 6, day: 6, zone}).toJSDate())

			// No hours because it's a "date", not "time" field.
			o(viewModel.endDate.toISOString())
				.equals(DateTime.fromObject({year: 2020, month: 6, day: 7, zone}).toJSDate().toISOString())
			o(viewModel.endTime).equals("15:00")
		})
	})

	o.spec("addAttendee", function () {
		o("to new event", async function () {
			const calendars = makeCalendars("own")
			const viewModel = init({calendars, existingEvent: null})
			const newGuest = "new-attendee@example.com"

			viewModel.addAttendee(newGuest)

			o(viewModel.attendees).deepEquals([
				createCalendarEventAttendee({
					address: mailAddress,
					status: CalendarAttendeeStatus.ACCEPTED,
				}),
				createCalendarEventAttendee({
					address: createEncryptedMailAddress({address: newGuest}),
					status: CalendarAttendeeStatus.NEEDS_ACTION,
				})
			])
		})

		o("to existing event", async function () {
			const calendars = makeCalendars("own")
			const existingEvent = createCalendarEvent({})
			const viewModel = init({calendars, existingEvent})
			const newGuest = "new-attendee@example.com"

			viewModel.addAttendee(newGuest)

			o(viewModel.attendees).deepEquals([
				createCalendarEventAttendee({
					address: mailAddress,
					status: CalendarAttendeeStatus.ACCEPTED,
				}),
				createCalendarEventAttendee({
					address: createEncryptedMailAddress({address: newGuest}),
					status: CalendarAttendeeStatus.NEEDS_ACTION,
				})
			])
		})

		o("to existing event as duplicate", async function () {
			const calendars = makeCalendars("own")
			const guest = "new-attendee@example.com"
			const existingEvent = createCalendarEvent({
				attendees: [createCalendarEventAttendee({address: createEncryptedMailAddress({address: guest})})]
			})
			const viewModel = init({calendars, existingEvent})

			viewModel.addAttendee(guest)

			// Organizer is not added because new attendee was not added
			o(viewModel.attendees).deepEquals([
				createCalendarEventAttendee({
					address: createEncryptedMailAddress({address: guest}),
					status: CalendarAttendeeStatus.NEEDS_ACTION,
				})
			])
		})
	})

	o.spec("selectGoing", function () {
		o("self is added to the guests when selected in own event", async function () {
			const calendars = makeCalendars("own")
			const attendee = createCalendarEventAttendee({
				address: createEncryptedMailAddress({address: "guest@example.com"})
			})
			const existingEvent = createCalendarEvent({
				attendees: [attendee]
			})
			const viewModel = init({calendars, existingEvent})

			viewModel.selectGoing(CalendarAttendeeStatus.ACCEPTED)

			o(viewModel.attendees()).deepEquals([
				{
					address: mailAddress,
					status: CalendarAttendeeStatus.ACCEPTED,
					type: RecipientInfoType.INTERNAL,
					contact: null,
				},
				{
					address: attendee.address,
					status: attendee.status,
					type: RecipientInfoType.UNKNOWN,
					contact: null,
				},
			])
		})

		o("status of own attendee is changed selected in own event", async function () {
			const calendars = makeCalendars("own")
			const attendee = createCalendarEventAttendee({
				address: createEncryptedMailAddress({address: "guest@example.com"})
			})
			const ownAttendee = createCalendarEventAttendee({
				address: mailAddress,
			})
			const existingEvent = createCalendarEvent({
				attendees: [attendee, ownAttendee]
			})
			const viewModel = init({calendars, existingEvent})

			viewModel.selectGoing(CalendarAttendeeStatus.DECLINED)

			o(viewModel.attendees).deepEquals([
				attendee,
				createCalendarEventAttendee({
					address: ownAttendee.address,
					status: CalendarAttendeeStatus.DECLINED
				})
			])
		})

		o("status of own attendee is changed selected in invite", async function () {
			const calendars = makeCalendars("own")
			const attendee = createCalendarEventAttendee({
				address: createEncryptedMailAddress({address: "guest@example.com"})
			})
			const ownAttendee = createCalendarEventAttendee({
				address: mailAddress
			})
			const existingEvent = createCalendarEvent({
				attendees: [attendee, ownAttendee],
				organizer: createEncryptedMailAddress({address: "organizer@example.com"}),
				isCopy: true,
			})
			const viewModel = init({calendars, existingEvent})

			viewModel.selectGoing(CalendarAttendeeStatus.TENTATIVE)

			o(viewModel.attendees).deepEquals([
				attendee,
				createCalendarEventAttendee({
					address: ownAttendee.address,
					status: CalendarAttendeeStatus.TENTATIVE
				})
			])
		})
	})

	o.spec("canModifyOrganizer", function () {
		o("can modify when when new event and no guests", function () {
			const calendars = makeCalendars("own")
			const viewModel = init({calendars, existingEvent: null})
			o(viewModel.canModifyOrganizer()).equals(true)
		})

		o("can modify when when new own event and added guests", function () {
			const calendars = makeCalendars("own")
			const viewModel = init({calendars, existingEvent: null})
			viewModel.addAttendee("guest@example.com")
			o(viewModel.canModifyOrganizer()).equals(true)
		})

		o("can modify when own event and no guests", function () {
			const calendars = makeCalendars("own")
			const viewModel = init({
				calendars,
				existingEvent: createCalendarEvent({
					_id: ["listId", "calendarId"],
					_ownerGroup: calendarGroupId,
				})
			})
			o(viewModel.canModifyOrganizer()).equals(true)
		})

		o("can modify when own event without guests and added guests", function () {
			const calendars = makeCalendars("own")
			const viewModel = init({
				calendars,
				existingEvent: createCalendarEvent({
					_id: ["listId", "calendarId"],
					_ownerGroup: calendarGroupId,
				})
			})

			viewModel.addAttendee("guest@tutanota.de")

			o(viewModel.canModifyOrganizer()).equals(true)
		})

		o("cannot modify in own calendar when there were guests", function () {
			const calendars = makeCalendars("own")
			const viewModel = init({
				calendars,
				existingEvent: createCalendarEvent({
					_id: ["listId", "calendarId"],
					_ownerGroup: calendarGroupId,
					attendees: [createCalendarEventAttendee({address: createEncryptedMailAddress({address: "guest@tutanota.com"})})]
				})
			})

			o(viewModel.canModifyOrganizer()).equals(false)
		})

		o("cannot modify in own calendar when there were guests and they were removed", function () {
			const calendars = makeCalendars("own")
			const guestAddress = "guest@tutanota.com"
			const viewModel = init({
				calendars,
				existingEvent: createCalendarEvent({
					_id: ["listId", "calendarId"],
					_ownerGroup: calendarGroupId,
					attendees: [createCalendarEventAttendee({address: createEncryptedMailAddress({address: guestAddress})})]
				})
			})

			viewModel.removeAttendee(guestAddress)

			o(viewModel.canModifyOrganizer()).equals(false)
		})

		o("cannot modify in ro shared calendar without guests", function () {
			const calendars = makeCalendars("shared")
			const viewModel = init({
				calendars,
				existingEvent: createCalendarEvent({
					_id: ["listId", "calendarId"],
					_ownerGroup: calendarGroupId,
				})
			})

			o(viewModel.canModifyOrganizer()).equals(false)
		})

		o("can modify in rw shared calendar without guests", function () {
			const calendars = makeCalendars("shared")
			const userController = makeUserController()
			addCapability(userController.user, calendarGroupId, ShareCapability.Write)
			const viewModel = init({
				calendars,
				userController,
				existingEvent: createCalendarEvent({
					_id: ["listId", "calendarId"],
					_ownerGroup: calendarGroupId,
				})
			})

			o(viewModel.canModifyOrganizer()).equals(false)
		})

		o("cannot modify when it's invite in own calendar", function () {
			const calendars = makeCalendars("own")
			const viewModel = init({
				calendars,
				existingEvent: createCalendarEvent({
					_id: ["listId", "calendarId"],
					_ownerGroup: calendarGroupId,
					isCopy: true,
				})
			})

			o(viewModel.canModifyOrganizer()).equals(false)
		})
	})
})

function makeMailModel(): MailModel {
	return downcast({
		getRecipientKeyData() {
			return null
		}
	});
}

function makeContactModel(): ContactModel {
	return {
		searchForContact() {
			return Promise.resolve(null)
		}
	}
}

function init({
	              userController = makeUserController(),
	              distributor = makeDistributor(),
	              mailboxDetail = makeMailboxDetail,
	              calendars,
	              existingEvent,
	              calendarModel = makeCalendarModel(),
	              mailModel = makeMailModel(),
	              contactModel = makeContactModel(),
              }: {|
	userController?: IUserController,
	distributor?: CalendarUpdateDistributor,
	mailboxDetail?: MailboxDetail,
	calendars: Map<Id, CalendarInfo>,
	calendarModel?: CalendarModel,
	mailModel?: MailModel,
	contactModel?: ContactModel,
	existingEvent: ?CalendarEvent,
|}): CalendarEventViewModel {
	return new CalendarEventViewModel(
		userController,
		distributor,
		calendarModel,
		mailboxDetail,
		mailModel,
		contactModel,
		now,
		zone,
		calendars,
		existingEvent
	)
}

function makeCalendars(type: "own" | "shared"): Map<string, CalendarInfo> {
	const calendarInfo = {
		groupRoot: downcast({}),
		longEvents: new LazyLoaded(() => Promise.resolve([])),
		groupInfo: downcast({}),
		group: createGroup({
			_id: calendarGroupId,
			type: GroupType.Calendar,
		}),
		shared: type === "shared"
	}
	return new Map([[calendarGroupId, calendarInfo]])
}

function makeUserController(aliases: Array<string> = []): IUserController {
	return downcast({
		user: createUser({_id: userId}),
		props: {
			defaultSender: mailAddress,
		},
		userGroupInfo: createGroupInfo({
			mailAddressAliases: aliases.map((address) => createMailAddressAlias({mailAddress: address, enabled: true})),
			mailAddress: mailAddress.address,
		}),
		userSettingsGroupRoot: {
			timeFormat: TimeFormat.TWENTY_FOUR_HOURS,
		}
	})
}

function addCapability(user: User, groupId: Id, capability: ShareCapabilityEnum) {
	user.memberships.push(createGroupMembership({
		group: groupId,
		capability,
	}))
}

function makeAttendee(address: string = "attendee@example.com") {
	return createCalendarEventAttendee({
		address: createEncryptedMailAddress({
			address
		})
	})
}

function makeMailboxDetail(): MailboxDetail {
	return {
		mailbox: createMailBox(),
		folders: [],
		mailGroupInfo: createGroupInfo(),
		mailGroup: createGroup({user: userId}),
		mailboxGroupRoot: createMailboxGroupRoot(),
	}
}

function makeDistributor(): CalendarUpdateDistributor {
	return {
		sendInvite: o.spy(() => Promise.resolve()),
		sendUpdate: o.spy(() => Promise.resolve()),
		sendCancellation: o.spy(() => Promise.resolve()),
		sendResponse: o.spy(() => Promise.resolve()),
	}
}

function makeCalendarModel(): CalendarModel {
	return downcast({
		createEvent: o.spy(() => Promise.resolve()),
		updateEvent: o.spy(() => Promise.resolve()),
		deleteEvent: o.spy(() => Promise.resolve()),
		loadAlarms: o.spy(() => Promise.resolve([]))
	})
}

function assertAskedForUpdates(result: EventCreateResult): ((bool) => Promise<void>) {
	if (result.status !== "ok") {
		throw new Error(`Result is not ok: ${JSON.stringify(result)}`)
	}
	if (result.askForUpdates == null) {
		throw new Error("Did not ask for updates")
	}
	return result.askForUpdates
}