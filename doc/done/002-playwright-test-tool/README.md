# 002 Playwright Test Tool

To support functional testing, a UI testing framework has to be introduced. Playwright is the suitable tool for that purpose.

Please design a way to integrate the Playwright test tool into this project. It has to be integrated into the project, so it can be triggered.

The idea:

* There will be a script which will locally run the application with an empty database. The application (front end, back end, and the database) will be started in a docker container. The script will wait until the application is ready to accept requests.
* The test suite will start and will start tests using Playwright. Tests will include some initial data seeding via the UI and validation their existence. After that, there will be triggered other tests which will test the exact aspect they has to test.
* Tests are expected to create non-conflicting items, so previously triggered tests will not interfere with the next tests. 
* If necessary, the test suite can wipe the database and reseed it again.
* The initial seeding should be written separately, so it can be reused in other tests.

This is the idea for the further discussion.

The objective of introducing of this testing framework is to enable functional testing of the application, so new features can be tested and ferified before they are accepted. The tests should be able to run in a CI/CD pipeline. The deployment pipeline shouldn't rely on the tests or the rest results. The failure shouldn't be blocking the deployment.