//@flow
import type {WorkerClient} from "./WorkerClient"
import {EventController} from "./EventController"
import {EntropyCollector} from "./EntropyCollector"
import {SearchModel} from "../../search/SearchModel"
import type {CalendarUpdateDistributor} from "../../calendar/CalendarUpdateDistributor"
import type {MailboxDetail} from "../../mail/MailModel"
import {MailModel} from "../../mail/MailModel"
import type {CalendarInfo} from "../../calendar/CalendarView"
import type {CalendarEvent} from "../entities/tutanota/CalendarEvent"
import type {CalendarEventViewModel} from "../../calendar/CalendarEventViewModel"
import {assertMainOrNode} from "../Env"
import {Notifications} from "../../gui/Notifications"
import {logins} from "./LoginController"
import type {CalendarModel} from "../../calendar/CalendarModel"
import {CalendarModelImpl} from "../../calendar/CalendarModel"
import {asyncImport, lazyMemoized} from "../common/utils/Utils"
import {getTimeZone} from "../../calendar/CalendarUtils"
import type {ContactModel} from "../../contacts/ContactModel"
import {ContactModelImpl} from "../../contacts/ContactModel"
import {LazyLoaded} from "../common/utils/LazyLoaded"
import type {SendMailModel} from "../../mail/SendMailModel"

assertMainOrNode()

export type MainLocatorType = {
	eventController: EventController;
	entropyCollector: EntropyCollector;
	search: SearchModel;
	calendarUpdateDistributor: () => Promise<CalendarUpdateDistributor>;
	// Async because we have dependency cycles all over the place. It's also a good idea to not import it right away.
	calendarEventViewModel: (
		date: Date,
		calendars: Map<Id, CalendarInfo>,
		mailboxDetail: MailboxDetail,
		existingEvent?: CalendarEvent,
	) => Promise<CalendarEventViewModel>;
	mailModel: MailModel;
	init: (WorkerClient) => void;
	calendarModel(): CalendarModel;
	contactModel(): Promise<ContactModel>;
}

export const locator: MainLocatorType = ({
	init(worker: WorkerClient) {
		const importBase = typeof module !== "undefined" ? module.id : __moduleName
		this.eventController = new EventController(logins)
		this.entropyCollector = new EntropyCollector(worker)
		this.search = new SearchModel(worker)
		this.mailModel = new MailModel(new Notifications(), this.eventController)

		this.calendarUpdateDistributor = () =>
			asyncImport(importBase, `${env.rootPathPrefix}src/calendar/CalendarUpdateDistributor.js`)
				.then(({CalendarMailDistributor}) => new CalendarMailDistributor())

		this.calendarEventViewModel = (date, calendars, mailboxDetail, existingEvent) =>
			Promise.all([
				this.calendarUpdateDistributor(),
				(asyncImport(importBase, `${env.rootPathPrefix}src/calendar/CalendarEventViewModel.js`):
					Promise<{CalendarEventViewModel: Class<CalendarEventViewModel>}>),
				(asyncImport(importBase, `${env.rootPathPrefix}src/mail/SendMailModel.js`): Promise<{SendMailModel: Class<SendMailModel>}>),
				contactModel.getAsync(),
			]).then(([distributor, {CalendarEventViewModel}, {SendMailModel}, contactModel]) =>
				new CalendarEventViewModel(
					logins.getUserController(),
					distributor,
					this.calendarModel(),
					mailboxDetail,
					(mailboxDetail) => new SendMailModel(logins, this.mailModel, contactModel, this.eventController, mailboxDetail),
					date,
					getTimeZone(),
					calendars,
					existingEvent,
				)
			)
		this.calendarModel = lazyMemoized(() =>
			new CalendarModelImpl(new Notifications, this.eventController, worker, logins.getUserController()))
		const contactModel = new LazyLoaded(() => asyncImport(importBase, `${env.rootPathPrefix}src/contacts/ContactModel.js`)
			.then(({ContactModelImpl: modelClass}) => new (modelClass: Class<ContactModelImpl>)(worker)))
		this.contactModel = () => contactModel.getAsync()
	},
}: any)

if (typeof window !== "undefined") {
	window.tutao.locator = locator
}